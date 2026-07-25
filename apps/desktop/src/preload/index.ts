import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LogcutApi, TranscribeProgress } from '../shared/ipc'

const api: LogcutApi = {
  getSettingsStatus: () => ipcRenderer.invoke('settings:get-status'),
  setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickVideo: () => ipcRenderer.invoke('dialog:pick-video'),
  transcribeVideo: (videoPath, force, config) =>
    ipcRenderer.invoke('transcribe:run', videoPath, force, config),
  getSystemLocale: () => ipcRenderer.invoke('system:get-locale'),
  getLanguagePreference: () => ipcRenderer.invoke('settings:get-language'),
  setLanguagePreference: (option) => ipcRenderer.invoke('settings:set-language', option),
  registerMedia: (videoPath) => ipcRenderer.invoke('media:register', videoPath),
  exportSrt: (transcript) => ipcRenderer.invoke('export:srt', transcript),
  listProjects: () => ipcRenderer.invoke('project:list'),
  openProject: (id) => ipcRenderer.invoke('project:open', id),
  saveProject: (transcript) => ipcRenderer.invoke('project:save', transcript),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  onTranscribeProgress: (callback) => {
    const listener = (_event: unknown, progress: TranscribeProgress): void => callback(progress)
    ipcRenderer.on('transcribe:progress', listener)
    return () => {
      ipcRenderer.removeListener('transcribe:progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('logcut', api)
