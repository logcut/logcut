import { normalizeCaptionStyles, normalizeExportSettings, randomId } from '@logcut/core'
import type { CaptionStyles, EditCommand, ExportSettings, Transcript } from '@logcut/core'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_CHARS_MAX, MAX_CHARS_MIN } from '../shared/ipc'
import type { MediaKind, TranscriptStatus } from '../shared/ipc'

/**
 * Bumped on any incompatible on-disk change. loadProject returns null for
 * anything else, so leftovers from an older layout are ignored rather than
 * crashing the project list.
 */
const PROJECT_SCHEMA_VERSION = 2

/** The persisted subset of the wire status — 'running' is in-flight only.
 *  **Derived rather than restated**, so the two cannot drift. */
export type StoredTranscriptStatus = Exclude<TranscriptStatus, 'running'>

export interface MediaAsset {
  id: string
  /** Absolute path as of import. Never used for identity. */
  path: string
  fileName: string
  kind: MediaKind
  fileSize: number
  fileMtimeMs: number
  /** Container duration from ffprobe; 0 when probing failed. */
  durationMs: number
  width?: number
  height?: number
  addedAt: number
  /** File name inside <projectDir>/thumbs/, absent until a poster exists. */
  thumbnail?: string
  /** Timeline strip of frames, in <projectDir>/thumbs/. Absent until built. */
  filmstrip?: string
  /** Audio envelope PNG, in <projectDir>/waveforms/. Absent until built. */
  waveform?: string
  /**
   * Which version of the generation parameters the three pictures above were
   * built with. Absent counts as stale, so anything that failed to build once
   * is retried rather than staying missing until the file is imported again.
   */
  artworkVersion?: number
  transcriptStatus: StoredTranscriptStatus
  /** configCacheKey of the language config the stored transcript came from. */
  transcriptConfigKey?: string
  hasRaw?: boolean
  rawProvider?: string
}

export interface ProjectFile {
  version: number
  /** Unrelated to any file path: a project outlives and precedes its media. */
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Clips laid end to end, in order. Empty until something is dragged in —
   *  importing alone puts nothing on the timeline. Absent in older projects,
   *  which read as empty, so this needed no schema bump. */
  timeline: TimelineClip[]
  assets: MediaAsset[]
  /** Longest subtitle line, in characters; absent reads as the core's default.
   *  **Project-level rather than per-asset** — one cut should not change its
   *  mind about line length between clips. */
  maxChars?: number
  /** How the captions look; `normalizeCaptionStyles` fills in whatever an
   *  older file is missing, so this needed no schema bump either. */
  captionStyles?: CaptionStyles
  /** How this project was last exported; normalized on load like the two
   *  above, so no schema bump. */
  exportSettings?: ExportSettings
}

/** **A clip references an asset rather than being one**: the same file can sit
 *  on the timeline twice, and removing a clip must not touch the library. No
 *  in/out point yet — see projects.md. */
export interface TimelineClip {
  id: string
  assetId: string
}

export const DEFAULT_PROJECT_NAME = 'Untitled project'

function projectsDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

function projectDir(id: string): string {
  return path.join(projectsDir(), id)
}

function projectFilePath(id: string): string {
  return path.join(projectDir(id), 'project.json')
}

function transcriptPath(id: string, assetId: string): string {
  return path.join(projectDir(id), 'transcripts', `${assetId}.json`)
}

function rawPath(id: string, assetId: string): string {
  return path.join(projectDir(id), 'raw', `${assetId}.json`)
}

/** The transcript as it stood before the first edit — what the command log
 *  replays onto (see main/projects.md). */
function basePath(id: string, assetId: string): string {
  return path.join(projectDir(id), 'transcripts', `${assetId}.base.json`)
}

/** The command log, project-wide: a batch can name more than one asset. */
function historyPath(id: string): string {
  return path.join(projectDir(id), 'history.json')
}

export function thumbnailPath(id: string, fileName: string): string {
  return path.join(projectDir(id), 'thumbs', fileName)
}

export function waveformPath(id: string, fileName: string): string {
  return path.join(projectDir(id), 'waveforms', fileName)
}

/** **Write through a temp file.** A plain `writeFileSync` interrupted mid-flight
 *  leaves truncated JSON, which `loadProject` reports as "no such project" —
 *  the user sees their work vanish. */
function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  fs.renameSync(temp, filePath)
}

export function loadProject(id: string): ProjectFile | null {
  try {
    const project = JSON.parse(fs.readFileSync(projectFilePath(id), 'utf8')) as ProjectFile
    if (project.version !== PROJECT_SCHEMA_VERSION) return null
    // Filled in here so every reader past this point can assume the array.
    project.timeline ??= []
    project.captionStyles = normalizeCaptionStyles(project.captionStyles)
    project.exportSettings = normalizeExportSettings(project.exportSettings)
    return project
  } catch {
    return null
  }
}

export function createProject(name?: string): ProjectFile {
  const now = Date.now()
  const project: ProjectFile = {
    version: PROJECT_SCHEMA_VERSION,
    id: randomId(),
    name: name?.trim() || DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    timeline: [],
    assets: []
  }
  writeJsonAtomic(projectFilePath(project.id), project)
  return project
}

/** Load, mutate, stamp updatedAt, persist. Returns null if the project is gone. */
function update(id: string, mutate: (project: ProjectFile) => void): ProjectFile | null {
  const project = loadProject(id)
  if (!project) return null
  mutate(project)
  project.updatedAt = Date.now()
  writeJsonAtomic(projectFilePath(id), project)
  return project
}

export function renameProject(id: string, name: string): ProjectFile | null {
  return update(id, (project) => {
    project.name = name.trim() || DEFAULT_PROJECT_NAME
  })
}

export function setCaptionStyles(id: string, styles: CaptionStyles): ProjectFile | null {
  return update(id, (project) => {
    // Normalized rather than assigned: the same guarantee that makes an old
    // file safe to open makes a renderer's value safe to store.
    project.captionStyles = normalizeCaptionStyles(styles)
  })
}

export function setExportSettings(id: string, settings: ExportSettings): ProjectFile | null {
  return update(id, (project) => {
    project.exportSettings = normalizeExportSettings(settings)
  })
}

/** Clamped here rather than trusted from the renderer: this value reaches a
 *  core function that has no opinion about absurd input. */
export function setMaxChars(id: string, maxChars: number): ProjectFile | null {
  return update(id, (project) => {
    project.maxChars = Math.round(Math.min(MAX_CHARS_MAX, Math.max(MAX_CHARS_MIN, maxChars)))
  })
}

export function deleteProject(id: string): void {
  for (const key of [...pendingTranscripts.keys()]) {
    if (key.startsWith(`${id}/`)) discardPendingTranscript(key)
  }
  fs.rmSync(projectDir(id), { recursive: true, force: true })
}

/** Directories are projects; anything else in here is ignored. */
export function listProjects(): ProjectFile[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectsDir(), { withFileTypes: true })
  } catch {
    return []
  }
  const projects: ProjectFile[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const project = loadProject(entry.name)
    if (project) projects.push(project)
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function addAsset(id: string, asset: MediaAsset): ProjectFile | null {
  return update(id, (project) => {
    project.assets.push(asset)
  })
}

export function removeAsset(id: string, assetId: string): ProjectFile | null {
  const project = loadProject(id)
  const asset = project?.assets.find((candidate) => candidate.id === assetId)
  if (!project || !asset) return project

  discardPendingTranscript(transcriptKey(id, assetId))
  fs.rmSync(transcriptPath(id, assetId), { force: true })
  fs.rmSync(rawPath(id, assetId), { force: true })
  if (asset.thumbnail) fs.rmSync(thumbnailPath(id, asset.thumbnail), { force: true })
  if (asset.filmstrip) fs.rmSync(thumbnailPath(id, asset.filmstrip), { force: true })
  if (asset.waveform) fs.rmSync(waveformPath(id, asset.waveform), { force: true })

  return update(id, (current) => {
    current.assets = current.assets.filter((candidate) => candidate.id !== assetId)
    // Every clip cut from this asset goes with it; a clip pointing at a file
    // that is no longer in the library has nothing to play.
    current.timeline = current.timeline.filter((clip) => clip.assetId !== assetId)
  })
}

/** Append an asset to the end of the timeline. */
export function addTimelineClip(id: string, assetId: string): ProjectFile | null {
  return update(id, (project) => {
    if (project.assets.some((asset) => asset.id === assetId)) {
      project.timeline.push({ id: randomId(), assetId })
    }
  })
}

/**
 * Replace the whole timeline.
 *
 * Undo needs this: putting a removed clip back means restoring the order it
 * sat in, and `addTimelineClip` only ever appends. Clips naming an asset that
 * is no longer in the library are dropped rather than rejected — the library
 * is the authority on what exists.
 */
export function setTimeline(id: string, clips: TimelineClip[]): ProjectFile | null {
  return update(id, (project) => {
    project.timeline = clips.filter((clip) =>
      project.assets.some((asset) => asset.id === clip.assetId)
    )
  })
}

export function removeTimelineClip(id: string, clipId: string): ProjectFile | null {
  return update(id, (project) => {
    project.timeline = project.timeline.filter((clip) => clip.id !== clipId)
  })
}

export function updateAsset(
  id: string,
  assetId: string,
  patch: Partial<Omit<MediaAsset, 'id'>>
): ProjectFile | null {
  return update(id, (project) => {
    const asset = project.assets.find((candidate) => candidate.id === assetId)
    if (asset) Object.assign(asset, patch)
  })
}

/**
 * Transcript writes are debounced: every keystroke that commits an edit calls
 * this, and the whole transcript is rewritten each time. The pending value is
 * the source of truth until it lands, so reads go through the same buffer.
 */
const TRANSCRIPT_WRITE_DELAY_MS = 500

interface PendingTranscript {
  timer: NodeJS.Timeout
  transcript: Transcript
}

const pendingTranscripts = new Map<string, PendingTranscript>()

function transcriptKey(id: string, assetId: string): string {
  return `${id}/${assetId}`
}

function flushTranscript(key: string): void {
  const pending = pendingTranscripts.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingTranscripts.delete(key)
  const separator = key.indexOf('/')
  writeJsonAtomic(
    transcriptPath(key.slice(0, separator), key.slice(separator + 1)),
    pending.transcript
  )
}

function discardPendingTranscript(key: string): void {
  const pending = pendingTranscripts.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingTranscripts.delete(key)
}

/** Must run before the app quits, or the last edits are lost. */
export function flushTranscripts(): void {
  for (const key of [...pendingTranscripts.keys()]) flushTranscript(key)
}

export function saveTranscript(
  id: string,
  assetId: string,
  transcript: Transcript,
  options: { immediate?: boolean } = {}
): void {
  const key = transcriptKey(id, assetId)
  const pending = pendingTranscripts.get(key)
  if (pending) clearTimeout(pending.timer)
  pendingTranscripts.set(key, {
    timer: setTimeout(() => flushTranscript(key), TRANSCRIPT_WRITE_DELAY_MS),
    transcript
  })
  // A finished transcription is worth a synchronous write: it cost money and
  // several minutes, and losing it to a crash inside the debounce window would
  // mean paying for it again.
  if (options.immediate) flushTranscript(key)
}

export function loadTranscript(id: string, assetId: string): Transcript | null {
  const pending = pendingTranscripts.get(transcriptKey(id, assetId))
  if (pending) return pending.transcript
  try {
    return JSON.parse(fs.readFileSync(transcriptPath(id, assetId), 'utf8')) as Transcript
  } catch {
    return null
  }
}

/** Written once when a transcription completes, then immutable. */
export function saveRaw(id: string, assetId: string, raw: unknown): void {
  writeJsonAtomic(rawPath(id, assetId), raw)
}

/**
 * Store the transcript the edit log starts from.
 *
 * **Written whenever the transcript is rebuilt rather than edited** — a
 * transcription finishing, or a re-split at a new line length. Both mint fresh
 * ids for every line, so every command already recorded names lines that no
 * longer exist; the caller clears the log in the same breath.
 */
export function saveBaseTranscript(id: string, assetId: string, transcript: Transcript): void {
  writeJsonAtomic(basePath(id, assetId), transcript)
}

export function loadBaseTranscript(id: string, assetId: string): Transcript | null {
  try {
    return JSON.parse(fs.readFileSync(basePath(id, assetId), 'utf8')) as Transcript
  } catch {
    return null
  }
}

/**
 * The edit log: every batch that has been applied, in order.
 *
 * **Stored whole rather than appended to.** Undo has to take batches back off
 * the end, so the file is never merely additive; and the renderer already holds
 * the list it would have to send anyway. It is written on the same debounce as
 * a transcript, for the same reason.
 */
export function saveHistory(id: string, batches: EditCommand[][]): void {
  writeJsonAtomic(historyPath(id), { version: HISTORY_VERSION, batches })
}

export function loadHistory(id: string): EditCommand[][] {
  try {
    const stored = JSON.parse(fs.readFileSync(historyPath(id), 'utf8')) as {
      version?: number
      batches?: unknown
    }
    // A log written by a future version could name commands this build cannot
    // apply. Replaying half of one is worse than replaying none.
    if (stored.version !== HISTORY_VERSION || !Array.isArray(stored.batches)) return []
    return stored.batches as EditCommand[][]
  } catch {
    return []
  }
}

/** Bump when a command's shape changes in a way older logs cannot survive. */
const HISTORY_VERSION = 1

/**
 * The archived provider response, or null when this asset has none.
 *
 * Re-splitting the subtitles at a new line length reads this rather than the
 * stored transcript: the stored one is already split, and the splitter works
 * per utterance without ever merging across them, so re-splitting it could only
 * ever make lines shorter. The original long utterances are only in here.
 *
 * Null for anything transcribed before this file was archived — `hasRaw` on the
 * asset records which is which.
 */
export function loadRaw(id: string, assetId: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(rawPath(id, assetId), 'utf8')) as unknown
  } catch {
    return null
  }
}

export interface AssetState {
  missing: boolean
  /** File is present but its size/mtime no longer match what import recorded. */
  stale: boolean
}

export function assetState(asset: MediaAsset): AssetState {
  try {
    const stat = fs.statSync(asset.path)
    return {
      missing: false,
      stale: stat.size !== asset.fileSize || Math.round(stat.mtimeMs) !== asset.fileMtimeMs
    }
  } catch {
    return { missing: true, stale: false }
  }
}

/**
 * Whether the stored transcript can stand in for a fresh recognition. Guards
 * the only call that costs money, so it errs toward re-running: a changed file
 * or a different language config both miss.
 */
export function canReuseTranscript(asset: MediaAsset, configKey: string): boolean {
  if (asset.transcriptStatus !== 'ready') return false
  if ((asset.transcriptConfigKey ?? '') !== configKey) return false
  const state = assetState(asset)
  return !state.missing && !state.stale
}
