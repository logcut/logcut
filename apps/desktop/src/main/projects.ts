import { randomId, type Transcript } from '@logcut/core'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { MediaKind, TranscriptStatus } from '../shared/ipc'

/**
 * Bumped on any incompatible on-disk change. loadProject returns null for
 * anything else, so leftovers from an older layout are ignored rather than
 * crashing the project list.
 */
const PROJECT_SCHEMA_VERSION = 2

/**
 * The persisted subset of the wire status: 'running' describes an in-flight
 * request and has no meaning on disk. Deriving it rather than restating the
 * members keeps the two from drifting.
 */
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
  /** The asset the editor shows; null for an empty project. */
  activeAssetId: string | null
  assets: MediaAsset[]
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

export function thumbnailPath(id: string, fileName: string): string {
  return path.join(projectDir(id), 'thumbs', fileName)
}

export function waveformPath(id: string, fileName: string): string {
  return path.join(projectDir(id), 'waveforms', fileName)
}

/**
 * Write through a temp file. Transcript saves are frequent, and a plain
 * writeFileSync interrupted mid-flight leaves truncated JSON that loadProject
 * reports as "no such project" — the user sees their work vanish.
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  fs.renameSync(temp, filePath)
}

export function loadProject(id: string): ProjectFile | null {
  try {
    const project = JSON.parse(fs.readFileSync(projectFilePath(id), 'utf8')) as ProjectFile
    return project.version === PROJECT_SCHEMA_VERSION ? project : null
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
    activeAssetId: null,
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
    project.activeAssetId ??= asset.id
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
    if (current.activeAssetId === assetId) {
      current.activeAssetId = current.assets[0]?.id ?? null
    }
  })
}

export function setActiveAsset(id: string, assetId: string): ProjectFile | null {
  return update(id, (project) => {
    if (project.assets.some((asset) => asset.id === assetId)) project.activeAssetId = assetId
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

/** Written once when a transcription completes; never read back so far. */
export function saveRaw(id: string, assetId: string, raw: unknown): void {
  writeJsonAtomic(rawPath(id, assetId), raw)
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
