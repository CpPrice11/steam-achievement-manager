const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sam', {
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  listGames: (payload) => ipcRenderer.invoke('app:listGames', payload),
  saveSettings: (settings) => ipcRenderer.invoke('app:saveSettings', settings),
  getHistory: () => ipcRenderer.invoke('app:getHistory'),
  createAchievementBackup: (payload) => ipcRenderer.invoke('app:createAchievementBackup', payload),
  readAchievementBackup: (backupPath) => ipcRenderer.invoke('app:readAchievementBackup', backupPath),
  openBackupsFolder: () => ipcRenderer.invoke('app:openBackupsFolder'),
  recordHistory: (entry) => ipcRenderer.invoke('app:recordHistory', entry),
  openSteamPage: (appId) => ipcRenderer.invoke('app:openSteamPage', appId),
  cacheImage: (urls) => ipcRenderer.invoke('app:cacheImage', urls),
  diagnoseLibrary: () => ipcRenderer.invoke('app:diagnoseLibrary'),
  loadGame: (payload) => ipcRenderer.invoke('game:load', payload),
  setAchievement: (payload) => ipcRenderer.invoke('achievement:set', payload),
  setAllAchievements: (payload) => ipcRenderer.invoke('achievement:setAll', payload),
  applyAchievementChanges: (payload) => ipcRenderer.invoke('achievement:applyChanges', payload),
  readStats: (payload) => ipcRenderer.invoke('stats:read', payload),
  setStat: (payload) => ipcRenderer.invoke('stats:set', payload),
  resetStats: (payload) => ipcRenderer.invoke('stats:reset', payload),
  diagnoseSteamworks: (payload) => ipcRenderer.invoke('steamworks:diagnose', payload),
});
