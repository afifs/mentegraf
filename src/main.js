const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

// Resolve paths - __dirname is src/ in both dev and packaged
const isDev = !app.isPackaged
const srcPath = __dirname

const assetsPath = isDev
    ? path.join(__dirname, '..', 'assets')
    : path.join(process.resourcesPath, 'assets')

let mainWindow
let currentFile = null
let currentLang = 'tr'

const MENU_LABELS = {
  tr: {
    file: 'Dosya', newProject: 'Yeni Proje', open: 'Aç...', save: 'Kaydet',
    saveAs: 'Farklı Kaydet...', quit: 'Çıkış',
    edit: 'Düzenle', addNode: 'Düğüm Ekle', linkMode: 'Bağlantı Modu',
    deleteSelected: 'Seçili Sil', undo: 'Geri Al', redo: 'Yinele',
    view: 'Görünüm', relayout: 'Yeniden Düzenle', fitAll: 'Tümüne Sığdır',
    devTools: 'Geliştirici Araçları'
  },
  en: {
    file: 'File', newProject: 'New Project', open: 'Open...', save: 'Save',
    saveAs: 'Save As...', quit: 'Quit',
    edit: 'Edit', addNode: 'Add Node', linkMode: 'Link Mode',
    deleteSelected: 'Delete Selected', undo: 'Undo', redo: 'Redo',
    view: 'View', relayout: 'Relayout', fitAll: 'Fit All',
    devTools: 'Developer Tools'
  }
}

function buildMenu() {
  const L = MENU_LABELS[currentLang] || MENU_LABELS.tr

  const menu = Menu.buildFromTemplate([
    {
      label: L.file,
      submenu: [
        { label: L.newProject, accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-action', 'new') },
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
  buildMenu()
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Mentegraf', extensions: ['mentegraf', 'json'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    currentFile = result.filePaths[0]
    const data = fs.readFileSync(currentFile, 'utf8')
    mainWindow.webContents.send('file-opened', JSON.parse(data), currentFile)
    mainWindow.setTitle('Mentegraf — ' + path.basename(currentFile))
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
    mainWindow.setTitle('Mentegraf — ' + path.basename(currentFile))
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
    mainWindow.setTitle('Mentegraf — ' + path.basename(currentFile))
  }
  fs.writeFileSync(currentFile, JSON.stringify(data, null, 2), 'utf8')
  return true
})

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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
