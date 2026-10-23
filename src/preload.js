const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mentegraf', {
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (e, action) => cb(action)),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data, path) => cb(data, path)),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', !!dirty),
  closeWindow: () => ipcRenderer.send('close-window'),
  setLang: (lang) => ipcRenderer.send('lang-changed', lang),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Zotero
  zoteroCheck: () => ipcRenderer.invoke('zotero-check'),
  zoteroCollections: () => ipcRenderer.invoke('zotero-collections'),
  zoteroItems: (collKey, limit) => ipcRenderer.invoke('zotero-items', collKey, limit),
  zoteroSearch: (query) => ipcRenderer.invoke('zotero-search', query),
})
