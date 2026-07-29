import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AgentRequest,
  AgentResponse,
  ExportProgress,
  LogcutApi,
  TranscribeProgress,
  UpdateState
} from '../shared/ipc'

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

  onSetOwnerStacks: (callback) => {
    const listener = (_event: unknown, on: boolean): void => callback(on)
    ipcRenderer.on('menu:set-owner-stacks', listener)
    return () => {
      ipcRenderer.removeListener('menu:set-owner-stacks', listener)
    }
  },

  getSettingsStatus: () => ipcRenderer.invoke('settings:get-status'),
  setApiKey: (key) => ipcRenderer.invoke('settings:set-api-key', key),
  getSystemLocale: () => ipcRenderer.invoke('system:get-locale'),
  getWaveform: (projectId, assetId) => ipcRenderer.invoke('project:waveform', projectId, assetId),
  getEditorLayout: () => ipcRenderer.invoke('settings:get-layout'),
  saveEditorLayout: (layout) => ipcRenderer.invoke('settings:save-layout', layout),
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
  setMaxChars: (projectId, maxChars) =>
    ipcRenderer.invoke('transcript:setMaxChars', projectId, maxChars),
  setCaptionStyles: (projectId, styles) =>
    ipcRenderer.invoke('project:setCaptionStyles', projectId, styles),
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

  exportVideo: (projectId) => ipcRenderer.invoke('export:video', projectId),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  getExportCapabilities: () => ipcRenderer.invoke('export:capabilities'),
  setExportSettings: (projectId, settings) =>
    ipcRenderer.invoke('export:settings', projectId, settings),
  onExportProgress: (callback) => {
    const listener = (_event: unknown, progress: ExportProgress): void => callback(progress)
    ipcRenderer.on('export:progress', listener)
    return () => {
      ipcRenderer.removeListener('export:progress', listener)
    }
  },

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
  },

  // The one handler that answers rather than listens: main relays a request
  // here and waits for the reply carrying the same id back. Registering also
  // announces that an editor exists to relay to, and unsubscribing withdraws
  // that — main answers "no editor open" in between rather than waiting.
  onAgentRequest: (handler) => {
    const listener = (_event: unknown, requestId: string, request: AgentRequest): void => {
      // A throw here would leave main waiting out its timeout for something
      // that has already failed, so it comes back as a plain answer instead.
      const response: AgentResponse = ((): AgentResponse => {
        try {
          return handler(request)
        } catch (cause: unknown) {
          return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
        }
      })()
      ipcRenderer.send('agent:response', requestId, response)
    }
    ipcRenderer.on('agent:request', listener)
    ipcRenderer.send('agent:ready')
    return () => {
      ipcRenderer.removeListener('agent:request', listener)
      ipcRenderer.send('agent:gone')
    }
  }
}

contextBridge.exposeInMainWorld('logcut', api)
