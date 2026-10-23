const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mentegraf', {
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (e, action) => cb(action)),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data, path, opts) => cb(data, path, opts)),
  saveData: (data, fragments) => ipcRenderer.invoke('save-data', data, fragments),
  fragmentNewPath: (label, type, nodeId, taken) => ipcRenderer.invoke('fragment-new-path', label, type, nodeId, taken),
  fragmentRead: (p) => ipcRenderer.invoke('fragment-read', p),
  citePick: () => ipcRenderer.invoke('cite-pick'),
  exportDocx: (p, text, lang) => ipcRenderer.invoke('export-docx', p, text, lang),
  onFragmentChanged: (cb) => ipcRenderer.on('fragment-changed', (e, p) => cb(p)),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', !!dirty),
  closeWindow: () => ipcRenderer.send('close-window'),
  writeRecovery: (data) => ipcRenderer.send('write-recovery', data),
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  setLang: (lang) => ipcRenderer.send('lang-changed', lang),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Zotero
  zoteroCheck: () => ipcRenderer.invoke('zotero-check'),
  zoteroCollections: () => ipcRenderer.invoke('zotero-collections'),
  zoteroItems: (collKey, limit) => ipcRenderer.invoke('zotero-items', collKey, limit),
  zoteroSearch: (query) => ipcRenderer.invoke('zotero-search', query),
})
