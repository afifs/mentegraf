const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mentegraf', {
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (e, action) => cb(action)),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data, path) => cb(data, path)),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  setLang: (lang) => ipcRenderer.send('lang-changed', lang),
})
