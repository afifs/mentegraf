const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const ProjectFormat = require('./projectFormat')
const ProjectStore = require('./projectStore')
const Exporter = require('./exporter')
const Styles = require('./styles')
const Compiler = require('./compiler')

// Resolve paths
const isDev = !app.isPackaged
const srcPath = __dirname
const assetsPath = isDev
  ? path.join(__dirname, '..', 'assets')
  : path.join(process.resourcesPath, 'assets')

let mainWindow
let currentDir = null      // folder of the open project; null = untitled
let isDirty = false
let forceClose = false
let autoSaveOn = true                 // mirrors the renderer's setting, for the File menu
let currentLang = 'tr'

const MENU_LABELS = {
  tr: {
    file: 'Dosya', newProject: 'Yeni Proje', open: 'Aç...', save: 'Kaydet',
    saveAs: 'Farklı Kaydet...', autoSave: 'Otomatik kaydet', quit: 'Çıkış',
    edit: 'Düzenle', addNode: 'Düğüm Ekle', linkMode: 'Bağlantı Modu',
    deleteSelected: 'Seçili Sil', undo: 'Geri Al', redo: 'Yinele',
    view: 'Görünüm', relayout: 'Yeniden Düzenle', fitAll: 'Tümüne Sığdır',
    devTools: 'Geliştirici Araçları',
    unsavedTitle: 'Kaydedilmemiş değişiklikler', unsavedMsg: 'Projede kaydedilmemiş değişiklikler var.',
    saveBtn: 'Kaydet', dontSave: 'Kaydetme', cancel: 'İptal', discard: 'Değişiklikleri at',
    openError: 'Proje açılamadı', saveError: 'Proje kaydedilemedi',
    newProjectTitle: 'Yeni proje klasörü', newProjectName: 'Yeni Proje', createBtn: 'Oluştur',
    notEmpty: 'Bu adla dolu bir klasör zaten var. Başka bir ad seçin.',
    notFolder: 'Bu adla bir dosya zaten var. Başka bir ad seçin.',
    convertTitle: 'Eski proje biçimi',
    convertMsg: 'Bu, eski tek dosyalı bir proje. Mentegraf yanına bir proje klasörü oluşturacak; özgün dosyaya dokunulmayacak.',
    convertBtn: 'Klasöre dönüştür',
    convertDone: 'Proje klasörü oluşturuldu:',
    recoveryTitle: 'Kurtarılan değişiklikler',
    recoveryMsg: 'Önceki oturumdan kaydedilmemiş değişiklikler bulundu.',
    restoreBtn: 'Geri yükle', discardBtn: 'At',
    warningsTitle: 'Proje uyarıları',
    warningsMsg: 'Proje açıldı, ancak bazı dosyalar sorun içeriyor:',
    wConflict: 'Eşitleme çakışması kopyası (yüklenmedi, yerinde bırakıldı)',
    wDuplicate: 'Yinelenen düğüm (yüklenmedi)',
    wUnreadable: 'Okunamayan dosya (yüklenmedi)',
    wDangling: 'eksik düğüme bağlı bağlantı yüklenmedi',
    exportTitle: 'Word (DOCX) olarak dışa aktar', exportDone: 'Belge oluşturuldu.', openBtn: 'Aç',
    pandocMissing: 'Pandoc bulunamadı. pandoc.org adresinden kurun, ardından Mentegraf\'ı yeniden başlatın.',
    pandocOld: 'Pandoc sürümü çok eski (%s). pandoc.org adresinden güncel sürümü kurun.',
    importStyleTitle: 'Kaynak gösterme biçimi seçin (.csl)', importTemplateTitle: 'Word şablonu seçin (.docx)',
    compileTitle: 'Kitabı derle', compileDone: 'Kitap derlendi.',
    textSearch: 'Metinlerde ara',
    assetFigureTitle: 'Görsel seçin', assetTableTitle: 'Tablo için CSV dosyası seçin', imagesLabel: 'Görseller'
  },
  en: {
    file: 'File', newProject: 'New Project', open: 'Open...', save: 'Save',
    saveAs: 'Save As...', autoSave: 'Auto-save', quit: 'Quit',
    edit: 'Edit', addNode: 'Add Node', linkMode: 'Link Mode',
    deleteSelected: 'Delete Selected', undo: 'Undo', redo: 'Redo',
    view: 'View', relayout: 'Relayout', fitAll: 'Fit All',
    devTools: 'Developer Tools',
    unsavedTitle: 'Unsaved changes', unsavedMsg: 'The project has unsaved changes.',
    saveBtn: 'Save', dontSave: "Don't Save", cancel: 'Cancel', discard: 'Discard changes',
    openError: 'Could not open project', saveError: 'Could not save project',
    newProjectTitle: 'New project folder', newProjectName: 'New Project', createBtn: 'Create',
    notEmpty: 'A folder with this name already exists and is not empty. Choose another name.',
    notFolder: 'A file with this name already exists. Choose another name.',
    convertTitle: 'Older project format',
    convertMsg: 'This is an older single-file project. Mentegraf will create a project folder next to it; the original file is not changed.',
    convertBtn: 'Convert to folder',
    convertDone: 'Project folder created:',
    recoveryTitle: 'Recovered changes',
    recoveryMsg: 'Unsaved changes from a previous session were found.',
    restoreBtn: 'Restore', discardBtn: 'Discard',
    warningsTitle: 'Project warnings',
    warningsMsg: 'The project opened, but some files have problems:',
    wConflict: 'Sync conflict copy (not loaded, left in place)',
    wDuplicate: 'Duplicate node (not loaded)',
    wUnreadable: 'Unreadable file (not loaded)',
    wDangling: 'link(s) to a missing node not loaded',
    exportTitle: 'Export to Word (DOCX)', exportDone: 'Document created.', openBtn: 'Open',
    pandocMissing: 'Pandoc was not found. Install it from pandoc.org, then restart Mentegraf.',
    pandocOld: 'Pandoc %s is too old. Install the current version from pandoc.org.',
    importStyleTitle: 'Choose a citation style (.csl)', importTemplateTitle: 'Choose a Word template (.docx)',
    compileTitle: 'Compile the book', compileDone: 'The book was compiled.',
    textSearch: 'Search in texts',
    assetFigureTitle: 'Choose an image', assetTableTitle: 'Choose a CSV file for the table', imagesLabel: 'Images'
  }
}

function labels() { return MENU_LABELS[currentLang] || MENU_LABELS.tr }
function windowAlive() { return !!(mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) }
function send(channel, ...args) { if (windowAlive()) mainWindow.webContents.send(channel, ...args) }

// Tell the renderer where the project folder is, so it can show images from assets/.
let lastBase
function sendProjectBase(force) {
  const u = currentDir ? require('url').pathToFileURL(currentDir + path.sep).href : null
  if (force || u !== lastBase) { lastBase = u; send('project-base', u) }
}

function updateTitle() {
  if (!windowAlive()) return
  sendProjectBase()
  mainWindow.setTitle('Mentegraf' + (currentDir ? ' — ' + path.basename(currentDir) : '') + (isDirty ? ' •' : ''))
}

// ───────── recovery file (replaces the old localStorage autosave) ─────────

// Recovery files live in Mentegraf's own settings folder on this computer, never
// in the project: they change every 30 s and must not be picked up by sync clients.
function untitledRecoveryPath() { return path.join(app.getPath('userData'), 'recovery-untitled.json') }
function recoveryPath() {
  if (!currentDir) return untitledRecoveryPath()
  const key = require('crypto').createHash('sha1').update(path.resolve(currentDir).toLowerCase()).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'recovery', key + '.json')
}
let lastRecovery = { file: null, text: null }
function removeQuietly(file) { try { fs.unlinkSync(file) } catch (e) { /* not there */ } }
function clearRecovery() { removeQuietly(recoveryPath()); lastRecovery = { file: null, text: null } }

// If a recovery file exists, ask whether to restore it. Returns project data or null.
function offerRecovery(file, newerThan) {
  let stat
  try { stat = fs.statSync(file) } catch (e) { return null }
  if (newerThan && stat.mtimeMs <= newerThan) { removeQuietly(file); return null }
  let data = null
  try { data = ProjectFormat.migrate(JSON.parse(fs.readFileSync(file, 'utf8'))).data } catch (e) { removeQuietly(file); return null }
  const L = labels()
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question', title: L.recoveryTitle, message: L.recoveryMsg,
    detail: new Date(stat.mtimeMs).toLocaleString(currentLang === 'tr' ? 'tr-TR' : 'en-GB'),
    buttons: [L.restoreBtn, L.discardBtn], defaultId: 0, cancelId: 1
  })
  if (choice === 0) return data
  removeQuietly(file)
  return null
}

// ───────── citations (Zotero + Better BibTeX) and DOCX export (Pandoc) ─────────

let pickInFlight = false
ipcMain.handle('cite-pick', async () => {
  if (pickInFlight) return { error: 'busy' }
  pickInFlight = true
  try {
    const text = await Exporter.citePicker()
    try { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } } catch (e) { /* stay put */ }   // back from Zotero
    return { text }
  } catch (e) {
    return { error: e.code || 'zotero', message: e.message }
  } finally { pickInFlight = false }
})

// Export settings -> exporter options. citationStyle / wordTemplate: project-relative path,
// 'default' (none) or unset (use what the project folder has).
function exportOptions(settings) {
  const s = settings && typeof settings === 'object' ? settings : { language: settings }
  const notes = []
  const pick = v => {
    if (v === undefined || v === null || v === '') return undefined
    if (v === 'default') return null
    try { return Styles.resolve(currentDir, v) } catch (e) { notes.push(e.message); return null }
  }
  return { lang: s.language === 'en' ? 'en' : 'tr', csl: pick(s.citationStyle), reference: pick(s.wordTemplate), notes }
}

const COMPILE_FORMATS = { docx: ['Word', 'docx'], epub: ['EPUB', 'epub'], md: ['Markdown', 'md'] }

ipcMain.handle('compile-book', async (event, job) => {
  if (!currentDir) return { error: 'untitled' }
  const L = labels()
  const format = job && COMPILE_FORMATS[job.format] ? job.format : 'docx'
  const items = job && Array.isArray(job.items) ? job.items.slice(0, 5000) : []
  if (!items.some(i => i && i.kind === 'node')) return { error: 'empty' }
  const title = String((job && job.title) || '').trim() || path.basename(currentDir)
  const res = await dialog.showSaveDialog(mainWindow, {
    title: L.compileTitle, defaultPath: path.join(currentDir, 'exports', ProjectStore.slugify(title) + '.' + COMPILE_FORMATS[format][1]),
    filters: [{ name: COMPILE_FORMATS[format][0], extensions: [COMPILE_FORMATS[format][1]] }]
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  try {
    fs.mkdirSync(path.dirname(res.filePath), { recursive: true })
    const o = exportOptions(job.settings)
    const r = await Compiler.compileBook({
      projectDir: currentDir, items, title, format, lang: o.lang, csl: o.csl, reference: o.reference, outFile: res.filePath,
      readText: rel => { const f = ProjectStore.readFragment(currentDir, rel); return f.exists ? f.text : null }
    })
    const warnings = o.notes.concat(r.warnings)
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: warnings.length ? 'warning' : 'info', title: L.compileTitle, message: L.compileDone,
      detail: res.filePath + (warnings.length ? '\n\n' + warnings.slice(0, 10).join('\n') : ''),
      buttons: [L.openBtn, 'OK'], defaultId: 0, cancelId: 1
    })
    if (choice === 0) require('electron').shell.openPath(res.filePath)
    return { ok: true, out: res.filePath }
  } catch (e) {
    if (e.code === 'empty') return { error: 'empty' }
    const info = e.code === 'pandoc-old' ? Exporter.pandocInfo() : null
    dialog.showErrorBox(L.compileTitle, e.code === 'pandoc' ? L.pandocMissing : info ? L.pandocOld.replace('%s', info.version) : e.message)
    return { error: e.code || 'failed' }
  }
})

// Images and CSV files for figure and table nodes, copied into <project>/assets.
function importAssetSafely(src) {
  if (!currentDir) return { error: 'untitled' }
  try { return ProjectStore.importAsset(currentDir, src) } catch (e) { return { error: e.code || 'failed', message: e.message } }
}

ipcMain.handle('asset-import', async (event, kind) => {
  if (!currentDir) return { error: 'untitled' }
  const L = labels(), table = kind === 'table'
  const res = await dialog.showOpenDialog(mainWindow, {
    title: table ? L.assetTableTitle : L.assetFigureTitle, properties: ['openFile'],
    filters: [table ? { name: 'CSV', extensions: ['csv'] } : { name: L.imagesLabel, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
  })
  if (res.canceled || !res.filePaths.length) return { canceled: true }
  return importAssetSafely({ file: res.filePaths[0] })
})

ipcMain.handle('asset-import-path', (event, file) => {
  try { if (typeof file !== 'string' || !fs.statSync(file).isFile()) return { error: 'failed', message: 'Not a file.' } } catch (e) { return { error: 'failed', message: e.message } }
  return importAssetSafely({ file })
})

ipcMain.handle('asset-import-data', (event, name, data) => {
  if (!data || typeof data.length !== 'number') return { error: 'failed', message: 'No data.' }
  return importAssetSafely({ name: String(name || 'gorsel.png'), data: Buffer.from(data) })
})

// Citation styles and Word templates for the Settings window.
ipcMain.handle('styles-list', () => {
  try { return Object.assign({ untitled: !currentDir }, Styles.listOptions(currentDir, app.getPath('userData'))) } catch (e) {
    return { untitled: !currentDir, styles: [], templates: [], error: e.message }
  }
})

ipcMain.handle('styles-import', async (event, kind) => {
  const L = labels(), csl = kind === 'csl'
  const res = await dialog.showOpenDialog(mainWindow, {
    title: csl ? L.importStyleTitle : L.importTemplateTitle, properties: ['openFile'],
    defaultPath: (csl && Styles.zoteroStylesDir()) || app.getPath('documents'),
    filters: [csl ? { name: 'CSL', extensions: ['csl'] } : { name: 'Word', extensions: ['docx'] }]
  })
  if (res.canceled || !res.filePaths.length) return { canceled: true }
  try { return Styles.importToLibrary(res.filePaths[0], csl ? 'csl' : 'docx', app.getPath('userData')) } catch (e) {
    return { error: e.code || 'failed', message: e.message }
  }
})

ipcMain.handle('styles-use', (event, value) => {
  if (!currentDir) return { error: 'untitled' }
  try { return { rel: Styles.useInProject(currentDir, value) } } catch (e) { return { error: e.code || 'failed', message: e.message } }
})

ipcMain.handle('export-docx', async (event, rel, text, settings) => {
  if (!currentDir) return { error: 'untitled' }
  const L = labels()
  const base = path.basename(String(rel || 'metin')).replace(/\.md$/i, '')
  const res = await dialog.showSaveDialog(mainWindow, {
    title: L.exportTitle, defaultPath: path.join(currentDir, 'exports', base + '.docx'),
    filters: [{ name: 'Word', extensions: ['docx'] }]
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  try {
    fs.mkdirSync(path.dirname(res.filePath), { recursive: true })
    // Settings: language, citationStyle / wordTemplate = project-relative path, 'default' (none),
    // or unset (use what the project folder has). Older callers pass just the language.
    const s = settings && typeof settings === 'object' ? settings : { language: settings }
    const notes = []
    const pick = v => {
      if (v === undefined || v === null || v === '') return undefined
      if (v === 'default') return null
      try { return Styles.resolve(currentDir, v) } catch (e) { notes.push(e.message); return null }
    }
    const r = await Exporter.exportDocx({
      projectDir: currentDir, fragmentPath: rel, text: String(text || ''), lang: s.language === 'en' ? 'en' : 'tr',
      csl: pick(s.citationStyle), reference: pick(s.wordTemplate), outFile: res.filePath
    })
    r.warnings = notes.concat(r.warnings)
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: r.warnings.length ? 'warning' : 'info', title: L.exportTitle, message: L.exportDone,
      detail: res.filePath + (r.warnings.length ? '\n\n' + r.warnings.slice(0, 8).join('\n') : ''),
      buttons: [L.openBtn, 'OK'], defaultId: 0, cancelId: 1
    })
    if (choice === 0) require('electron').shell.openPath(res.filePath)
    return { ok: true, out: res.filePath }
  } catch (e) {
    const info = e.code === 'pandoc-old' ? Exporter.pandocInfo() : null
    dialog.showErrorBox(L.exportTitle, e.code === 'pandoc' ? L.pandocMissing : info ? L.pandocOld.replace('%s', info.version) : e.message)
    return { error: e.code || 'failed' }
  }
})

// ───────── texts (Markdown files attached to nodes) ─────────

let textWatchers = []
const textTimers = {}
function unwatchTexts() { textWatchers.forEach(w => { try { w.close() } catch (e) { /* ignore */ } }); textWatchers = [] }
// Tell the renderer when a text changes on disk (another editor, a sync client).
function watchTexts() {
  unwatchTexts()
  if (!currentDir) return
  ProjectStore.TEXT_DIRS.forEach(sub => {
    const d = path.join(currentDir, sub)
    try {
      fs.mkdirSync(d, { recursive: true })
      textWatchers.push(fs.watch(d, { recursive: true }, (ev, fname) => {
        if (!fname || !/\.md$/i.test(String(fname))) return
        const rel = (sub + '/' + String(fname)).split(path.sep).join('/')
        clearTimeout(textTimers[rel])
        textTimers[rel] = setTimeout(() => send('fragment-changed', rel), 250)
      }))
    } catch (e) { console.warn('Text watch failed:', e.message) }
  })
}

ipcMain.handle('fragment-new-path', (event, label, type, nodeId, taken) => {
  if (!currentDir) return { error: 'untitled' }
  try { return { path: ProjectStore.newFragmentPath(currentDir, label, type, nodeId, taken) } } catch (e) { return { error: 'failed', message: e.message } }
})

// Search in all texts; open editor texts come along so unsaved changes are found too.
ipcMain.handle('text-search', (event, query, opts) => {
  const o = opts && typeof opts === 'object' ? opts : {}
  try {
    return ProjectStore.searchTexts(currentDir || null, String(query || '').slice(0, 200), {
      overrides: o.overrides && typeof o.overrides === 'object' ? o.overrides : {},
      only: Array.isArray(o.only) ? o.only.slice(0, 5000) : undefined,
      limit: 300
    })
  } catch (e) { return { files: [], total: 0, truncated: false, error: e.message } }
})

ipcMain.handle('fragment-stats', (event, paths) => {
  if (!currentDir) return { counts: {} }
  try { return { counts: ProjectStore.fragmentStats(currentDir, Array.isArray(paths) ? paths.slice(0, 2000) : []) } } catch (e) { return { counts: {} } }
})

ipcMain.handle('fragment-read', (event, rel) => {
  if (!currentDir) return { error: 'untitled', message: '' }
  try { return ProjectStore.readFragment(currentDir, rel) } catch (e) { return { error: 'failed', message: e.message } }
})

ipcMain.on('write-recovery', (event, data) => {
  const file = recoveryPath(), text = JSON.stringify(data)
  if (file === lastRecovery.file && text === lastRecovery.text) return   // nothing new
  try { ProjectStore.atomicWrite(file, text); lastRecovery = { file, text } } catch (e) { console.warn('Recovery write failed:', e.message) }
})

// ───────── open / new / save ─────────

// Ask before throwing away unsaved work. Returns true when it is OK to proceed.
function confirmDiscard() {
  if (!isDirty) return true
  const L = labels()
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning', title: L.unsavedTitle, message: L.unsavedMsg,
    buttons: [L.discard, L.cancel], defaultId: 1, cancelId: 1
  })
  if (choice !== 0) return false
  clearRecovery()
  return true
}

function showWarnings(warnings) {
  if (!warnings || !warnings.length) return
  const L = labels()
  const lines = warnings.slice(0, 12).map(w => {
    if (w.kind === 'conflict') return '• ' + L.wConflict + ': ' + w.file
    if (w.kind === 'duplicate') return '• ' + L.wDuplicate + ': ' + w.file
    if (w.kind === 'dangling') return '• ' + w.count + ' ' + L.wDangling
    return '• ' + L.wUnreadable + ': ' + w.file
  })
  if (warnings.length > 12) lines.push('… +' + (warnings.length - 12))
  dialog.showMessageBox(mainWindow, { type: 'warning', title: L.warningsTitle, message: L.warningsMsg, detail: lines.join('\n') })
}

function loadDir(dir) {
  let res
  try { res = ProjectStore.readProject(dir) } catch (e) {
    dialog.showErrorBox(labels().openError, path.basename(dir) + '\n\n' + e.message)
    return
  }
  currentDir = dir
  watchTexts()
  // Older builds kept the recovery file inside the project: move it out.
  const oldRecovery = path.join(dir, '.mentegraf', 'recovery.json')
  if (fs.existsSync(oldRecovery)) {
    try { fs.mkdirSync(path.dirname(recoveryPath()), { recursive: true }); if (!fs.existsSync(recoveryPath())) fs.copyFileSync(oldRecovery, recoveryPath()) } catch (e) { /* ignore */ }
    removeQuietly(oldRecovery)
  }
  let data = res.project
  let manifestTime = 0
  try { manifestTime = fs.statSync(path.join(dir, ProjectStore.MANIFEST)).mtimeMs } catch (e) { /* ignore */ }
  const recovered = offerRecovery(recoveryPath(), manifestTime)
  if (recovered) data = recovered
  isDirty = !!recovered
  send('file-opened', data, currentDir, { recovered: !!recovered })
  updateTitle()
  showWarnings(res.warnings)
}

// Open a project.mentegraf manifest, or convert an old single-file project.
function openPath(file) {
  let kind
  try { kind = ProjectStore.classify(file) } catch (e) {
    dialog.showErrorBox(labels().openError, path.basename(file) + '\n\n' + e.message)
    return
  }
  if (kind === 'folder') return loadDir(path.dirname(file))
  const L = labels()
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'question', title: L.convertTitle, message: L.convertMsg, detail: path.basename(file),
    buttons: [L.convertBtn, L.cancel], defaultId: 0, cancelId: 1
  })
  if (choice !== 0) return
  let dir
  try { dir = ProjectStore.convertLegacy(file) } catch (e) {
    dialog.showErrorBox(labels().openError, path.basename(file) + '\n\n' + e.message)
    return
  }
  loadDir(dir)
  dialog.showMessageBox(mainWindow, { type: 'info', title: L.convertTitle, message: L.convertDone, detail: dir })
}

async function openFile() {
  if (!confirmDiscard()) return
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Mentegraf', extensions: ['mentegraf', 'json'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) openPath(result.filePaths[0])
}

function newProject() {
  if (!confirmDiscard()) return
  currentDir = null
  unwatchTexts()
  isDirty = false
  updateTitle()
  send('menu-action', 'new')
}

// Ask for a name; the project becomes a folder of that name. Returns the folder or null.
async function chooseNewProjectDir() {
  const L = labels()
  for (;;) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: L.newProjectTitle, buttonLabel: L.createBtn,
      defaultPath: path.join(currentDir ? path.dirname(currentDir) : app.getPath('documents'), L.newProjectName),
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null
    const dir = result.filePath.replace(/\.(mentegraf|json)$/i, '')
    const problem = ProjectStore.checkNewProjectDir(dir)
    if (!problem) return dir
    dialog.showErrorBox(L.saveError, path.basename(dir) + '\n\n' + (problem === 'not-a-folder' ? L.notFolder : L.notEmpty))
  }
}

async function saveFileAs() {
  const dir = await chooseNewProjectDir()
  if (!dir) return
  if (currentDir) {
    try { ProjectStore.copyTextFolders(currentDir, dir) } catch (e) {
      dialog.showErrorBox(labels().saveError, path.basename(dir) + '\n\n' + e.message)
      return
    }
  }
  clearRecovery()        // the old location's recovery no longer applies
  currentDir = dir
  watchTexts()
  updateTitle()
  send('menu-action', 'save')
}

// Save data from renderer
ipcMain.handle('save-data', async (event, data, fragments, opts) => {
  const auto = !!(opts && opts.auto)
  if (!currentDir) {
    if (auto) return 'untitled'           // auto-save never asks for a folder
    const dir = await chooseNewProjectDir()
    if (!dir) return false
    currentDir = dir
  }
  try {
    ProjectStore.writeFragments(currentDir, fragments || [])   // texts first, graph last
    ProjectStore.writeProject(currentDir, data)
  } catch (e) {
    if (auto) { console.warn('Auto-save failed:', e.message); return false }
    dialog.showErrorBox(labels().saveError, path.basename(currentDir) + '\n\n' + e.message)
    return false
  }
  clearRecovery()
  removeQuietly(untitledRecoveryPath())
  if (!textWatchers.length) watchTexts()
  updateTitle()
  return true
})

ipcMain.on('autosave-state', (event, on) => { autoSaveOn = !!on; buildMenu() })
ipcMain.on('set-dirty', (event, dirty) => { isDirty = !!dirty; updateTitle() })
ipcMain.on('close-window', () => { forceClose = true; if (mainWindow) mainWindow.close() })

// Renderer finished its start-up: open a project passed on the command line
// (double-click on project.mentegraf), else offer an untitled recovery.
ipcMain.once('renderer-ready', () => {
  sendProjectBase(true)
  const arg = process.argv.slice(1).find(a => /\.(mentegraf|json)$/i.test(a) && fs.existsSync(a))
  if (arg) return openPath(path.resolve(arg))
  const recovered = offerRecovery(untitledRecoveryPath(), 0)
  if (recovered) {
    isDirty = true
    send('file-opened', recovered, null, { recovered: true })
    updateTitle()
  }
})

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
        { label: L.autoSave, type: 'checkbox', checked: autoSaveOn, click: () => send('menu-action', 'toggle-autosave') },
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
        { label: L.textSearch, accelerator: 'CmdOrCtrl+Shift+H', click: () => mainWindow.webContents.send('menu-action', 'text-search') },
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
    else if (choice === 1) { clearRecovery(); forceClose = true; mainWindow.close() }
  })
  // After closing, a text watcher or timer may still fire (saving writes the texts): stop them all.
  mainWindow.on('closed', () => {
    unwatchTexts()
    Object.keys(textTimers).forEach(k => clearTimeout(textTimers[k]))
    mainWindow = null
  })
  buildMenu()
}

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
    query: { lang: currentLang, v: app.getVersion() }
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
