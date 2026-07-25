import type { Transcript } from '@logcut/core'
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectSummary } from '../shared/ipc'

interface ProjectFile {
  id: string
  videoPath: string
  fileSize: number
  fileMtimeMs: number
  createdAt: number
  updatedAt: number
  /** Normalized language config the transcript was produced with (see shared/language). */
  configKey?: string
  /** True when an immutable <id>.raw.json holds the original provider response. */
  hasRaw?: boolean
  /** ASR provider whose raw format is in the raw file (for future format handling). */
  rawProvider?: string
  transcript: Transcript
}

/** Cache key for the default (auto/simplified) language; also the fallback for pre-config projects. */
const DEFAULT_CONFIG_KEY = '|'

function projectsDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

export function projectIdForVideoPath(videoPath: string): string {
  return crypto.createHash('sha1').update(videoPath).digest('hex').slice(0, 16)
}

function projectPath(id: string): string {
  return path.join(projectsDir(), `${id}.json`)
}

function rawPath(id: string): string {
  return path.join(projectsDir(), `${id}.raw.json`)
}

function statVideo(videoPath: string): { fileSize: number; fileMtimeMs: number } | null {
  try {
    const stat = fs.statSync(videoPath)
    return { fileSize: stat.size, fileMtimeMs: Math.round(stat.mtimeMs) }
  } catch {
    return null
  }
}

export function loadProject(id: string): ProjectFile | null {
  try {
    return JSON.parse(fs.readFileSync(projectPath(id), 'utf8')) as ProjectFile
  } catch {
    return null
  }
}

/**
 * Persist a project. On transcription `raw` is the provider response, written
 * once to an immutable <id>.raw.json. Edit re-saves pass no raw and keep it.
 */
export function saveProject(transcript: Transcript, configKey?: string, raw?: unknown): void {
  const id = projectIdForVideoPath(transcript.sourcePath)
  const existing = loadProject(id)
  const stat = statVideo(transcript.sourcePath)
  const now = Date.now()
  fs.mkdirSync(projectsDir(), { recursive: true })
  if (raw !== undefined) fs.writeFileSync(rawPath(id), JSON.stringify(raw))
  const project: ProjectFile = {
    id,
    videoPath: transcript.sourcePath,
    fileSize: stat?.fileSize ?? existing?.fileSize ?? 0,
    fileMtimeMs: stat?.fileMtimeMs ?? existing?.fileMtimeMs ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Edit re-saves pass no configKey/raw; preserve what the transcription set.
    configKey: configKey ?? existing?.configKey,
    hasRaw: raw !== undefined ? true : existing?.hasRaw,
    rawProvider: raw !== undefined ? 'volcano' : existing?.rawProvider,
    transcript
  }
  fs.writeFileSync(projectPath(id), JSON.stringify(project))
}

export function deleteProject(id: string): void {
  fs.rmSync(projectPath(id), { force: true })
  fs.rmSync(rawPath(id), { force: true })
}

const EXCERPT_MAX_LENGTH = 120

function buildExcerpt(transcript: Transcript): string {
  let text = ''
  for (const utterance of transcript.utterances) {
    text = text === '' ? utterance.text : `${text} ${utterance.text}`
    if (text.length >= EXCERPT_MAX_LENGTH) break
  }
  return text.slice(0, EXCERPT_MAX_LENGTH)
}

export function listProjects(): ProjectSummary[] {
  let files: string[]
  try {
    files = fs
      .readdirSync(projectsDir())
      .filter((name) => name.endsWith('.json') && !name.endsWith('.raw.json'))
  } catch {
    return []
  }
  const summaries: ProjectSummary[] = []
  for (const file of files) {
    const project = loadProject(path.basename(file, '.json'))
    if (!project) continue
    summaries.push({
      id: project.id,
      videoPath: project.videoPath,
      fileName: path.basename(project.videoPath),
      updatedAt: project.updatedAt,
      utteranceCount: project.transcript.utterances.length,
      audioDurationMs: project.transcript.audioDurationMs,
      excerpt: buildExcerpt(project.transcript),
      fileExists: fs.existsSync(project.videoPath)
    })
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** True when the stored size/mtime no longer match the file on disk. */
export function isStale(project: {
  videoPath: string
  fileSize: number
  fileMtimeMs: number
}): boolean {
  const stat = statVideo(project.videoPath)
  if (!stat) return true
  return stat.fileSize !== project.fileSize || stat.fileMtimeMs !== project.fileMtimeMs
}

/** Cached transcript for a video path, only if the file and language config are unchanged. */
export function findFreshByVideoPath(videoPath: string, configKey?: string): Transcript | null {
  const project = loadProject(projectIdForVideoPath(videoPath))
  if (!project) return null
  if (isStale(project)) return null
  // Missing configKey (pre-config projects) counts as the default language.
  const wanted = configKey ?? DEFAULT_CONFIG_KEY
  if ((project.configKey ?? DEFAULT_CONFIG_KEY) !== wanted) return null
  return project.transcript
}
