import type { LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'

/**
 * Contracts for the Electron main <-> renderer boundary. These are shell
 * concerns (filesystem paths, native dialogs, media URLs) and deliberately
 * stay out of @logcut/core, which must remain platform-neutral.
 */

export interface SettingsStatus {
  hasApiKey: boolean
  /** Last 4 characters of the configured key, for display only. */
  apiKeyTail: string
}

export type TranscribePhase = 'extracting' | 'transcribing'

/**
 * Addressed by project and asset from the start, so moving recognition onto a
 * background queue later does not change the payload.
 */
export interface TranscribeProgress {
  projectId: string
  assetId: string
  phase: TranscribePhase
}

export type MediaKind = 'video' | 'audio'

/** 'running' reflects an in-flight request and is never persisted. */
export type TranscriptStatus = 'none' | 'running' | 'ready' | 'failed'

export interface MediaAssetSummary {
  id: string
  fileName: string
  /** Absolute path, for "missing file" messaging. */
  path: string
  kind: MediaKind
  /** Container duration from ffprobe; 0 when probing failed. */
  durationMs: number
  width?: number
  height?: number
  /** Playback URL, empty when the file is missing. */
  mediaUrl: string
  /** Poster frame URL, null until one has been generated. */
  thumbnailUrl: string | null
  /** Row of frames for the timeline's media track; null until generated. */
  filmstripUrl: string | null
  /** White-on-transparent audio envelope, coloured by CSS; null until generated. */
  waveformUrl: string | null
  /** The file is no longer at `path`. */
  missing: boolean
  /** Present but changed since import: transcript and poster may not match. */
  stale: boolean
  transcriptStatus: TranscriptStatus
}

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  assetCount: number
  /** Sum of asset durations; 0 for an empty project. */
  durationMs: number
  /** Poster of the active asset, or null so the card renders a placeholder. */
  thumbnailUrl: string | null
}

export interface ProjectDetail {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  activeAssetId: string | null
  assets: MediaAssetSummary[]
}

export type ImportRejectReason = 'UNSUPPORTED' | 'UNREADABLE'

export interface ImportMediaResult {
  project: ProjectDetail
  /** Paths that could not be imported; the rest still were. */
  rejected: { path: string; reason: ImportRejectReason }[]
}

export interface TranscribeResult {
  transcript: Transcript
  /** True when a stored transcript was reused and no paid request was made. */
  fromCache: boolean
}

export interface ExportSrtResult {
  savedPath?: string
}

/**
 * API exposed to the renderer through the preload bridge.
 * The plaintext API key never crosses this boundary.
 */
export interface LogcutApi {
  /**
   * macOS draws its own traffic lights in the renderer, so the window actions
   * have to come back over IPC. On other platforms the native title bar owns
   * them and these are never called.
   */
  closeWindow(): Promise<void>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>

  getSettingsStatus(): Promise<SettingsStatus>
  setApiKey(key: string): Promise<void>
  /** System UI locale (Electron app.getLocale), e.g. 'zh-CN', 'zh-TW', 'en-US'. */
  getSystemLocale(): Promise<string>
  /** The user's last chosen transcription language, or null if never set. */
  getLanguagePreference(): Promise<LanguageOption | null>
  /** Persist the user's transcription language choice. */
  setLanguagePreference(option: LanguageOption): Promise<void>

  /** Create an empty project; the editor opens on it right away. */
  createProject(name?: string): Promise<ProjectSummary>
  listProjects(): Promise<ProjectSummary[]>
  /** Registers a playback URL for every present asset. Throws PROJECT_MISSING. */
  openProject(projectId: string): Promise<ProjectDetail>
  renameProject(projectId: string, name: string): Promise<ProjectDetail>
  deleteProject(projectId: string): Promise<void>

  /** Resolve a dropped File to its filesystem path (webUtils.getPathForFile). */
  getPathForFile(file: File): string
  /** Native picker; resolves to an empty array when cancelled. */
  pickMedia(): Promise<string[]>
  importMedia(projectId: string, paths: string[]): Promise<ImportMediaResult>
  removeMedia(projectId: string, assetId: string): Promise<ProjectDetail>
  setActiveMedia(projectId: string, assetId: string): Promise<ProjectDetail>

  /** null when this asset has never been recognized. */
  getTranscript(projectId: string, assetId: string): Promise<Transcript | null>
  /** Called after every edit; debounced and written atomically in main. */
  saveTranscript(projectId: string, assetId: string, transcript: Transcript): Promise<void>
  /**
   * Explicit user action, the only call that spends API credit.
   * Throws API_KEY_MISSING / API_KEY_INVALID / NETWORK / ASR_FAILED.
   */
  transcribeAsset(
    projectId: string,
    assetId: string,
    options?: { force?: boolean; config?: TranscribeConfig }
  ): Promise<TranscribeResult>
  /** Subscribe to transcription progress. Returns an unsubscribe function. */
  onTranscribeProgress(callback: (progress: TranscribeProgress) => void): () => void

  /** Export an asset's transcript as SRT via a save dialog. Empty if cancelled. */
  exportSrt(projectId: string, assetId: string): Promise<ExportSrtResult>
}
