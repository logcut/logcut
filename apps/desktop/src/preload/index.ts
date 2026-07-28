import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LogcutApi, TranscribeProgress, UpdateState } from '../shared/ipc'

const api: LogcutApi = {
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),

  onOpenSettings: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('menu:open-settings', listener)
    return () => {
      ipcRenderer.removeListener('menu:open-settings', listener)
    }
  },

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
  addClip: (projectId, assetId) => ipcRenderer.invoke('timeline:add-clip', projectId, assetId),
  removeClip: (projectId, clipId) => ipcRenderer.invoke('timeline:remove-clip', projectId, clipId),
  setTimeline: (projectId, clips) => ipcRenderer.invoke('timeline:set', projectId, clips),

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

  onProjectUpdated: (callback) => {
    const listener = (_event: unknown, projectId: string): void => callback(projectId)
    ipcRenderer.on('project:updated', listener)
    return () => {
      ipcRenderer.removeListener('project:updated', listener)
    }
  },

  exportSrt: (projectId, assetId) => ipcRenderer.invoke('export:srt', projectId, assetId),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event: unknown, state: UpdateState): void => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => {
      ipcRenderer.removeListener('update:state', listener)
    }
  }
}

contextBridge.exposeInMainWorld('logcut', api)
