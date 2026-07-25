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

export interface TranscribeProgress {
  phase: TranscribePhase
}

export interface ProjectSummary {
  id: string
  videoPath: string
  fileName: string
  updatedAt: number
  utteranceCount: number
  audioDurationMs: number
  /** Leading transcript text for list previews, at most 120 characters; empty without utterances. */
  excerpt: string
  /** False when the source video no longer exists on disk. */
  fileExists: boolean
}

export interface OpenProjectResult {
  transcript: Transcript
  mediaUrl: string
  /** True when the video file changed since the transcript was saved. */
  stale: boolean
}

export interface ExportSrtResult {
  savedPath?: string
}

/**
 * API exposed to the renderer through the preload bridge.
 * The plaintext API key never crosses this boundary.
 */
export interface LogcutApi {
  getSettingsStatus(): Promise<SettingsStatus>
  setApiKey(key: string): Promise<void>
  /** Resolve a dropped File to its filesystem path (webUtils.getPathForFile). */
  getPathForFile(file: File): string
  /** Open a native file picker for a video; resolves to the path or null if cancelled. */
  pickVideo(): Promise<string | null>
  /** Transcribe a video; reuses the saved project unless force is true or the language config changed. */
  transcribeVideo(videoPath: string, force?: boolean, config?: TranscribeConfig): Promise<Transcript>
  /** System UI locale (Electron app.getLocale), e.g. 'zh-CN', 'zh-TW', 'en-US'. */
  getSystemLocale(): Promise<string>
  /** The user's last chosen transcription language, or null if never set. */
  getLanguagePreference(): Promise<LanguageOption | null>
  /** Persist the user's transcription language choice. */
  setLanguagePreference(option: LanguageOption): Promise<void>
  /** Subscribe to transcription progress. Returns an unsubscribe function. */
  onTranscribeProgress(callback: (progress: TranscribeProgress) => void): () => void
  /** Register a local video for playback; returns an logcut-media:// URL. */
  registerMedia(videoPath: string): Promise<string>
  /** Export the transcript as SRT via a save dialog. Empty result if cancelled. */
  exportSrt(transcript: Transcript): Promise<ExportSrtResult>
  listProjects(): Promise<ProjectSummary[]>
  openProject(id: string): Promise<OpenProjectResult>
  /** Persist the current transcript (called after every edit mutation). */
  saveProject(transcript: Transcript): Promise<void>
  deleteProject(id: string): Promise<void>
}
