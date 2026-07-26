import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LogcutApi, TranscribeProgress } from '../shared/ipc'

const api: LogcutApi = {
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),

  getSettingsStatus: () => ipcRenderer.invoke('settings:get-status'),
  setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
  getSystemLocale: () => ipcRenderer.invoke('system:get-locale'),
  getLanguagePreference: () => ipcRenderer.invoke('settings:get-language'),
  setLanguagePreference: (option) => ipcRenderer.invoke('settings:set-language', option),

  createProject: (name) => ipcRenderer.invoke('project:create', name),
  listProjects: () => ipcRenderer.invoke('project:list'),
  openProject: (projectId) => ipcRenderer.invoke('project:open', projectId),
  renameProject: (projectId, name) => ipcRenderer.invoke('project:rename', projectId, name),
  deleteProject: (projectId) => ipcRenderer.invoke('project:delete', projectId),

  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickMedia: () => ipcRenderer.invoke('dialog:pick-media'),
  importMedia: (projectId, paths) => ipcRenderer.invoke('media:import', projectId, paths),
  removeMedia: (projectId, assetId) => ipcRenderer.invoke('media:remove', projectId, assetId),
  setActiveMedia: (projectId, assetId) =>
    ipcRenderer.invoke('media:set-active', projectId, assetId),

  getTranscript: (projectId, assetId) => ipcRenderer.invoke('transcript:get', projectId, assetId),
  saveTranscript: (projectId, assetId, transcript) =>
    ipcRenderer.invoke('transcript:save', projectId, assetId, transcript),
  transcribeAsset: (projectId, assetId, options) =>
    ipcRenderer.invoke('transcript:transcribe', projectId, assetId, options),
  onTranscribeProgress: (callback) => {
    const listener = (_event: unknown, progress: TranscribeProgress): void => callback(progress)
    ipcRenderer.on('transcribe:progress', listener)
    return () => {
      ipcRenderer.removeListener('transcribe:progress', listener)
    }
  },

  exportSrt: (projectId, assetId) => ipcRenderer.invoke('export:srt', projectId, assetId)
}

contextBridge.exposeInMainWorld('logcut', api)
