const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const ProjectFormat = require('./projectFormat')

// Resolve paths
const isDev = !app.isPackaged
const srcPath = __dirname
const assetsPath = isDev 
  ? path.join(__dirname, '..', 'assets')
  : path.join(process.resourcesPath, 'assets')

let mainWindow
let currentFile = null
let isDirty = false
let forceClose = false
let currentLang = 'tr'

const MENU_LABELS = {
  tr: {
    file: 'Dosya', newProject: 'Yeni Proje', open: 'Aç...', save: 'Kaydet',
    saveAs: 'Farklı Kaydet...', quit: 'Çıkış',
    edit: 'Düzenle', addNode: 'Düğüm Ekle', linkMode: 'Bağlantı Modu',
    deleteSelected: 'Seçili Sil', undo: 'Geri Al', redo: 'Yinele',
    view: 'Görünüm', relayout: 'Yeniden Düzenle', fitAll: 'Tümüne Sığdır',
    devTools: 'Geliştirici Araçları',
    unsavedTitle: 'Kaydedilmemiş değişiklikler', unsavedMsg: 'Projede kaydedilmemiş değişiklikler var.',
    saveBtn: 'Kaydet', dontSave: 'Kaydetme', cancel: 'İptal', discard: 'Değişiklikleri at',
    openError: 'Proje açılamadı', saveError: 'Proje kaydedilemedi'
  },
  en: {
    file: 'File', newProject: 'New Project', open: 'Open...', save: 'Save',
    saveAs: 'Save As...', quit: 'Quit',
    edit: 'Edit', addNode: 'Add Node', linkMode: 'Link Mode',
    deleteSelected: 'Delete Selected', undo: 'Undo', redo: 'Redo',
    view: 'View', relayout: 'Relayout', fitAll: 'Fit All',
    devTools: 'Developer Tools',
    unsavedTitle: 'Unsaved changes', unsavedMsg: 'The project has unsaved changes.',
    saveBtn: 'Save', dontSave: "Don't Save", cancel: 'Cancel', discard: 'Discard changes',
    openError: 'Could not open project', saveError: 'Could not save project'
  }
}

function labels() { return MENU_LABELS[currentLang] || MENU_LABELS.tr }

function updateTitle() {
  if (!mainWindow) return
  mainWindow.setTitle('Mentegraf' + (currentFile ? ' — ' + path.basename(currentFile) : '') + (isDirty ? ' •' : ''))
}

// Ask before throwing away unsaved work. Returns true when it is OK to proceed.
function confirmDiscard() {
  if (!isDirty) return true
  const L = labels()
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning', title: L.unsavedTitle, message: L.unsavedMsg,
    buttons: [L.discard, L.cancel], defaultId: 1, cancelId: 1
  })
  return choice === 0
}

// Crash-safe save: write a temp file, flush it, keep the previous version as
// .bak, then rename over the original. A crash or sync client never sees a
// half-written project.
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
function atomicWrite(file, text) {
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.bak') } catch (e) { console.warn('Backup copy failed:', e.message) }
  }
  // Windows: antivirus or a sync client may hold the file briefly.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepMs(100 * (i + 1)); continue }
      throw e
    }
  }
}

function buildMenu() {
  const L = labels()

  const menu = Menu.buildFromTemplate([
    {
      label: L.file,
      submenu: [
        { label: L.newProject, accelerator: 'CmdOrCtrl+N', click: newProject },
        { label: L.open, accelerator: 'CmdOrCtrl+O', click: openFile },
        { label: L.save, accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-action', 'save') },
        { label: L.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: saveFileAs },
        { type: 'separator' },
        { label: L.quit, accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: L.edit,
      submenu: [
        { label: L.addNode, accelerator: 'CmdOrCtrl+D', click: () => mainWindow.webContents.send('menu-action', 'add-node') },
        { label: L.linkMode, accelerator: 'CmdOrCtrl+L', click: () => mainWindow.webContents.send('menu-action', 'link-mode') },
        { type: 'separator' },
        { label: L.deleteSelected, accelerator: 'Delete', click: () => mainWindow.webContents.send('menu-action', 'delete') },
        { type: 'separator' },
        { label: L.undo, accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu-action', 'undo') },
        { label: L.redo, accelerator: 'CmdOrCtrl+Shift+Z', click: () => mainWindow.webContents.send('menu-action', 'redo') }
      ]
    },
    {
      label: L.view,
      submenu: [
        { label: L.relayout, accelerator: 'CmdOrCtrl+R', click: () => mainWindow.webContents.send('menu-action', 'relayout') },
        { label: L.fitAll, accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.send('menu-action', 'fit') },
        { type: 'separator' },
        { label: L.devTools, accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: currentLang === 'tr' ? 'Hakkında' : 'About', click: openAbout }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 900, minHeight: 600,
    title: 'Mentegraf',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(srcPath, 'preload.js')
    },
    backgroundColor: '#0e0e14',
    icon: path.join(assetsPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  })

  mainWindow.loadFile(path.join(srcPath, 'index.html'))
  mainWindow.on('close', (e) => {
    if (forceClose || !isDirty) return
    e.preventDefault()
    const L = labels()
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: L.unsavedTitle, message: L.unsavedMsg,
      buttons: [L.saveBtn, L.dontSave, L.cancel], defaultId: 0, cancelId: 2
    })
    if (choice === 0) mainWindow.webContents.send('menu-action', 'save-then-close')
    else if (choice === 1) { forceClose = true; mainWindow.close() }
  })
  buildMenu()
}

function newProject() {
  if (!confirmDiscard()) return
  currentFile = null
  isDirty = false
  updateTitle()
  mainWindow.webContents.send('menu-action', 'new')
}

async function openFile() {
  if (!confirmDiscard()) return
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Mentegraf', extensions: ['mentegraf', 'json'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    const file = result.filePaths[0]
    let migrated
    try {
      migrated = ProjectFormat.migrate(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (e) {
      dialog.showErrorBox(labels().openError, path.basename(file) + '\n\n' + e.message)
      return
    }
    currentFile = file
    isDirty = false
    mainWindow.webContents.send('file-opened', migrated.data, currentFile)
    updateTitle()
  }
}

async function saveFileAs() {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Mentegraf', extensions: ['mentegraf'] }],
    defaultPath: 'project.mentegraf'
  })
  if (!result.canceled) {
    currentFile = result.filePath
    mainWindow.webContents.send('menu-action', 'save')
    updateTitle()
  }
}

// Save data from renderer
ipcMain.handle('save-data', async (event, data) => {
  if (!currentFile) {
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'Mentegraf', extensions: ['mentegraf'] }],
      defaultPath: 'project.mentegraf'
    })
    if (result.canceled) return false
    currentFile = result.filePath
  }
  try {
    atomicWrite(currentFile, JSON.stringify(data, null, 2))
  } catch (e) {
    dialog.showErrorBox(labels().saveError, path.basename(currentFile) + '\n\n' + e.message)
    return false
  }
  updateTitle()
  return true
})

ipcMain.on('set-dirty', (event, dirty) => { isDirty = !!dirty; updateTitle() })
ipcMain.on('close-window', () => { forceClose = true; if (mainWindow) mainWindow.close() })

// Language change from renderer
ipcMain.on('lang-changed', (event, lang) => {
  currentLang = lang
  buildMenu()
})


function openAbout() {
  const aboutWin = new BrowserWindow({
    width: 600, height: 700,
    resizable: true,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: false,
    title: currentLang === 'tr' ? 'Hakkında' : 'About',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  aboutWin.setMenuBarVisibility(false)
  aboutWin.loadFile(path.join(srcPath, 'about.html'), {
    query: { lang: currentLang }
  })
}

// ═══ ZOTERO LOCAL API PROXY ═══
const { shell } = require('electron')
const http = require('http')

function zoteroRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 23119,
      path: '/api/users/0' + endpoint,
      method: 'GET',
      headers: {
        'Zotero-API-Version': '3',
        'Accept': 'application/json'
      }
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)) }
          catch(e) { reject(new Error('Invalid JSON from Zotero')) }
        } else {
          reject(new Error('Zotero API ' + res.statusCode))
        }
      })
    })
    req.on('error', (e) => reject(e))
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Zotero timeout')) })
    req.end()
  })
}

function zoteroCheckAlive() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 23119,
      path: '/api/users/0/items?limit=1&format=json',
      method: 'GET',
      headers: { 'Zotero-API-Version': '3', 'Accept': 'application/json' }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        console.log('Zotero check: status=' + res.statusCode)
        resolve(res.statusCode >= 200 && res.statusCode < 400)
      })
    })
    req.on('error', (e) => { console.log('Zotero check error:', e.message); resolve(false) })
    req.setTimeout(5000, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url)
})

ipcMain.handle('zotero-check', async () => {
  return await zoteroCheckAlive()
})

ipcMain.handle('zotero-collections', async () => {
  return await zoteroRequest('/collections?format=json')
})

ipcMain.handle('zotero-items', async (event, collectionKey, limit) => {
  let url = collectionKey
    ? '/collections/' + collectionKey + '/items?format=json&limit=' + (limit || 200)
    : '/items?format=json&limit=' + (limit || 200)
  url += '&itemType=-attachment+-note'
  return await zoteroRequest(url)
})

ipcMain.handle('zotero-search', async (event, query) => {
  const url = '/items?format=json&q=' + encodeURIComponent(query) + '&itemType=-attachment+-note&limit=50'
  return await zoteroRequest(url)
})


app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
