import type {
  CaptionStyles,
  CommandResult,
  EditCommand,
  ExportCodec,
  ExportSettings,
  LanguageOption,
  TranscribeConfig,
  Transcript,
  UtteranceQuery,
  UtteranceQueryResult
} from '@logcut/core'

/**
 * Contracts for the Electron main <-> renderer boundary. These are shell
 * concerns (filesystem paths, native dialogs, media URLs) and deliberately
 * stay out of @logcut/core, which must remain platform-neutral.
 */

/**
 * How the editor is arranged, remembered between sessions.
 *
 * Sizes are the pixels the user dragged to, saved as-is and **clamped on read
 * rather than on write** — a layout saved on a wide display has to still open
 * sanely on a narrow one, and the value the user chose is worth keeping for
 * when they are back on the big screen.
 *
 * The two open flags are here because the columns are part of the arrangement:
 * reopening on the same working setup is the point of remembering at all.
 */
export interface EditorLayout {
  /** Side columns are pixels: a subtitle list wants the same width whatever
   *  the screen is (see EditorPage.md). */
  chatWidth: number
  subtitlesWidth: number
  /**
   * The two flexible splits, each a fraction of what it divides — **never
   * pixels** (see EditorPage.md). A pixel value reaching either of these is
   * read as a ratio, and a panel asking for 649 times the row collapses every
   * other one to nothing.
   */
  tabsRatio: number
  timelineRatio: number
  chatOpen: boolean
  subtitlesOpen: boolean
}

export interface SettingsStatus {
  hasApiKey: boolean
  /** Last 4 characters of the configured key, for display only. */
  apiKeyTail: string
}

/**
 * Bounds for the subtitle line length (ranges and their reasons: see
 * components/SubtitleTab.md).
 *
 * **Here rather than at either end of the bridge, because both need them and
 * they must agree**: the controls offer these ranges, and main clamps rather
 * than trusting what arrives.
 */
export const MAX_CHARS_MIN = 8
export const MAX_CHARS_SLIDER_MAX = 40
export const MAX_CHARS_MAX = 200

export type TranscribePhase = 'extracting' | 'transcribing'

/** Addressed by project and asset from the start, so moving recognition onto a
 *  background queue later cannot change the payload. */
export interface TranscribeProgress {
  projectId: string
  assetId: string
  phase: TranscribePhase
}

/** Where the updater is. `unsupported` (development build) and `current` are
 *  deliberately distinct — see ipc.md. */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'current' }
  | { kind: 'failed'; message: string }
  | { kind: 'unsupported' }

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
  /**
   * Whether an envelope exists to ask for. The samples themselves are fetched
   * once per asset through `getWaveform` rather than ridden along here: they
   * are two orders of magnitude larger than the rest of a summary, and this
   * shape is re-sent on every project update.
   */
  hasWaveform: boolean
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

/** One clip on the timeline, position already resolved in main so the two
 *  sides cannot disagree about where a clip sits (see ipc.md). */
export interface TimelineClipSummary {
  id: string
  assetId: string
  startMs: number
  durationMs: number
}

export interface ProjectDetail {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Clips laid end to end, in order; empty until one is dragged there. */
  timeline: TimelineClipSummary[]
  assets: MediaAssetSummary[]
  /** Longest subtitle line, in characters. Always a number on the wire — main
   *  fills in the core's default for projects that predate the setting. */
  maxChars: number
  /** Always complete on the wire; main normalizes what it read from disk. */
  captionStyles: CaptionStyles
  /** How this project was last exported. Complete on the wire for the same
   *  reason as the styles above. */
  exportSettings: ExportSettings
}

export type ImportRejectReason = 'UNSUPPORTED' | 'UNREADABLE'

export interface ImportMediaResult {
  project: ProjectDetail
  /** Paths that could not be imported; the rest still were. */
  rejected: { path: string; reason: ImportRejectReason }[]
}

/**
 * Outcome of changing the line length. Carries the re-split transcripts so the
 * renderer replaces them in one go instead of re-fetching each.
 */
export interface ResplitResult {
  project: ProjectDetail
  /** Re-split transcripts, keyed by asset id; only the ones that changed. */
  transcripts: Record<string, Transcript>
  /** Assets left alone because no provider response was archived for them. */
  skipped: string[]
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
 * How a video export ended.
 *
 * **Both fields absent means the save dialog was dismissed** — a third outcome
 * distinct from cancelling the render, and the only one with nothing to report:
 * the user never got as far as starting anything.
 */
export interface ExportVideoResult {
  savedPath?: string
  cancelled?: boolean
}

/**
 * Addressed by project like `TranscribeProgress`, and for the same reason: a
 * renderer with two projects open must be able to tell whose export this is.
 */
export interface ExportProgress {
  projectId: string
  /** Monotonic, 0–100. */
  percent: number
}

/**
 * What this build can actually produce.
 *
 * **A list rather than a boolean**, because the dialog has to offer the codecs
 * that exist and no others. Empty means no hardware encoder at all, which today
 * means Linux — a project with captions cannot be exported there, though one
 * without them still can (see main/export.md).
 */
export interface ExportCapabilities {
  codecs: ExportCodec[]
}

/**
 * What an agent may ask the editor to do.
 *
 * **The one channel that runs main → renderer and back**; everything else on
 * this bridge is the renderer asking main. Payloads are core types unchanged
 * (see ipc.md and packages/core/src/commands/index.md).
 */
export type AgentRequest =
  | { kind: 'session' }
  | { kind: 'query'; query: UtteranceQuery }
  | { kind: 'dispatch'; commands: EditCommand[] }

/** One clip as an agent sees it: what is on the timeline, in what order. */
export interface AgentClip {
  clipId: string
  assetId: string
  fileName: string
  startMs: number
  durationMs: number
  transcriptStatus: TranscriptStatus
}

export interface AgentSession {
  /** null while no project is open — the editor is not on screen at all. */
  project: { id: string; name: string } | null
  clips: AgentClip[]
}

/** **A result, not a rejection.** "No project open" and "that clip has no
 *  transcript yet" are ordinary states an agent reads and acts on — see
 *  ipc.md. */
/**
 * What a batch did, without the document it did it to.
 *
 * **Never widen this back to `CommandResult`.** That carries the whole new
 * document — right for the editor, wrong for a wire whose far end is a model's
 * context window, where a thousand-line transcript would cross on every edit.
 */
export type AgentDispatchResult = Omit<CommandResult, 'doc'>

export type AgentResponse =
  | { ok: true; kind: 'session'; session: AgentSession }
  | { ok: true; kind: 'query'; result: UtteranceQueryResult }
  | { ok: true; kind: 'dispatch'; result: AgentDispatchResult }
  | { ok: false; error: string }

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

  /**
   * The application menu's Settings item was chosen. The dialog belongs to the
   * renderer, so the menu can only ask. Returns an unsubscribe function.
   */
  onOpenSettings(callback: () => void): () => void

  /**
   * The Developer menu toggled React's owner stacks. Development builds only —
   * in a packaged app the menu does not exist and this never fires.
   */
  onSetOwnerStacks(callback: (on: boolean) => void): () => void

  getSettingsStatus(): Promise<SettingsStatus>
  setApiKey(key: string): Promise<void>
  /** System UI locale (Electron app.getLocale), e.g. 'zh-CN', 'zh-TW', 'en-US'. */
  getSystemLocale(): Promise<string>
  /** The user's last chosen transcription language, or null if never set. */
  getLanguagePreference(): Promise<LanguageOption | null>
  /**
   * An asset's audio envelope: one byte per point, `PEAKS_PER_SECOND` of them
   * per second (see main/ffmpeg.ts). Null when the asset has no audio or the
   * envelope has not been built yet.
   */
  getWaveform(projectId: string, assetId: string): Promise<Uint8Array | null>

  /** Persist the user's transcription language choice. */
  setLanguagePreference(option: LanguageOption): Promise<void>

  /** The remembered editor arrangement, or null before one has been saved. */
  getEditorLayout(): Promise<EditorLayout | null>
  /**
   * Write the arrangement. Resetting is the same call with the defaults in it —
   * there is no separate clear, because "no saved layout" and "the defaults
   * saved" are read back identically.
   */
  saveEditorLayout(layout: EditorLayout): Promise<void>

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
  /** Append an asset to the timeline. Importing does not do this on its own. */
  addClip(projectId: string, assetId: string): Promise<ProjectDetail>
  /** Remove one clip. The asset stays in the library. */
  removeClip(projectId: string, clipId: string): Promise<ProjectDetail>
  /**
   * Replace the whole timeline. Undo restores an order, which appending
   * cannot express.
   */
  setTimeline(projectId: string, clips: { id: string; assetId: string }[]): Promise<ProjectDetail>

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
  /**
   * Set the longest subtitle line and re-split every transcript that has an
   * archived provider response. Local and free — it spends no API credit,
   * which is the whole reason the response is archived.
   */
  setMaxChars(projectId: string, maxChars: number): Promise<ResplitResult>
  /** Set how the captions look. Affects the preview at once; nothing is
   *  re-split and no transcript is touched. */
  setCaptionStyles(projectId: string, styles: CaptionStyles): Promise<ProjectDetail>
  /** Subscribe to transcription progress. Returns an unsubscribe function. */
  onTranscribeProgress(callback: (progress: TranscribeProgress) => void): () => void
  /**
   * A project changed behind the renderer's back — posters, filmstrips and
   * waveforms are generated after the import call has already returned.
   * Returns an unsubscribe function.
   */
  onProjectUpdated(callback: (projectId: string) => void): () => void

  /** Export an asset's transcript as SRT via a save dialog. Empty if cancelled. */
  exportSrt(projectId: string, assetId: string): Promise<ExportSrtResult>

  /**
   * Render the timeline to a video file, picked through a save dialog.
   *
   * Long enough to watch, so progress arrives on `onExportProgress` — but the
   * outcome is this promise, not a terminal progress event. Throws
   * TIMELINE_EMPTY / MEDIA_MISSING / NO_ENCODER, and whatever ffmpeg said when
   * it failed.
   */
  exportVideo(projectId: string): Promise<ExportVideoResult>
  /** Stop the export in flight. It resolves as cancelled, not as a failure. */
  cancelExport(): Promise<void>
  /** Which codecs this build can produce; empty when it can encode nothing. */
  getExportCapabilities(): Promise<ExportCapabilities>
  /** Remember how this project is exported. Saved when the export starts, not
   *  while the dialog is being fiddled with (see components/ExportSettingsDialog.md). */
  setExportSettings(projectId: string, settings: ExportSettings): Promise<ProjectDetail>
  /** Subscribe to export progress. Returns an unsubscribe function. */
  onExportProgress(callback: (progress: ExportProgress) => void): () => void

  /** Version of the running build, for the settings dialog. */
  getAppVersion(): Promise<string>
  /** Where the updater is right now; the dialog may open mid-download. */
  getUpdateState(): Promise<UpdateState>
  /** Ask for a check. Progress and failures arrive on `onUpdateState`, never as
   *  a rejection (see ipc.md). */
  checkForUpdates(): Promise<void>
  /** Quit and relaunch into the downloaded version. Only valid when 'ready'. */
  installUpdate(): Promise<void>
  /** Subscribe to updater state. Returns an unsubscribe function. */
  onUpdateState(callback: (state: UpdateState) => void): () => void

  /**
   * Answer agent requests for as long as an editor is on screen. Returns an
   * unsubscribe function.
   *
   * **Registering is also what tells main there is anything to relay to**: with
   * no handler, an agent's call is answered "no editor open" at once rather than
   * waiting for a window that may never appear.
   */
  onAgentRequest(handler: (request: AgentRequest) => AgentResponse): () => void
}
