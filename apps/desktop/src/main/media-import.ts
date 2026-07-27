import { randomId } from '@logcut/core'
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isSupportedMediaFile } from '../shared/media'
import { extractFilmstrip, extractPoster, extractWaveform, probeMedia } from './ffmpeg'
import {
  addAsset,
  DEFAULT_PROJECT_NAME,
  loadProject,
  renameProject,
  thumbnailPath,
  updateAsset,
  waveformPath,
  type MediaAsset,
  type ProjectFile
} from './projects'

export type RejectReason = 'UNSUPPORTED' | 'UNREADABLE'

export interface RejectedImport {
  path: string
  reason: RejectReason
}

export interface ImportOutcome {
  project: ProjectFile
  rejected: RejectedImport[]
}

/**
 * Ten percent in, capped at ten seconds: far enough past the leader or fade-in
 * that the frame has content, close enough that the seek stays cheap.
 */
function posterOffsetMs(durationMs: number): number {
  return Math.min(durationMs * 0.1, 10_000)
}

/**
 * Poster, filmstrip and waveform are all decoration: the card falls back to a
 * placeholder and the timeline to a plain block. None may surface as an import
 * error, so each runs detached and only records itself once it succeeds.
 *
 * They are sequential rather than parallel — three ffmpeg processes over the
 * same multi-gigabyte file compete for the same disk, and nothing is waiting
 * on them.
 */
function generateArtwork(projectId: string, asset: MediaAsset): void {
  if (asset.durationMs === 0) return

  // Each piece lands minutes after the import call returned, so the renderer
  // has to be told; without this the editor keeps showing placeholders until
  // the project is reopened.
  const record = (patch: Partial<MediaAsset>) => (): void => {
    updateAsset(projectId, asset.id, patch)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('project:updated', projectId)
      }
    }
  }
  const warn =
    (what: string) =>
    (error: unknown): void => {
      console.warn(`[media-import] ${what} failed for ${asset.fileName}:`, error)
    }

  const poster = `${asset.id}.jpg`
  const filmstrip = `${asset.id}-strip.jpg`
  const waveform = `${asset.id}.png`

  void extractPoster(asset.path, posterOffsetMs(asset.durationMs), thumbnailPath(projectId, poster))
    .then(record({ thumbnail: poster }), warn('poster'))
    .then(() =>
      extractFilmstrip(asset.path, asset.durationMs, thumbnailPath(projectId, filmstrip)).then(
        record({ filmstrip }),
        warn('filmstrip')
      )
    )
    .then(() =>
      extractWaveform(asset.path, waveformPath(projectId, waveform)).then(
        record({ waveform }),
        warn('waveform')
      )
    )
}

/**
 * Validate, probe and persist each path as an asset of the project.
 *
 * Probing blocks because the duration is needed the moment the card and the
 * timeline render; it is a sub-second ffprobe call. A probe that fails still
 * imports the file, with a zero duration the UI renders as `--:--`.
 */
export async function importMedia(
  projectId: string,
  paths: string[]
): Promise<ImportOutcome | null> {
  let project = loadProject(projectId)
  if (!project) return null

  const rejected: RejectedImport[] = []
  const added: MediaAsset[] = []

  for (const filePath of paths) {
    const fileName = path.basename(filePath)
    if (!isSupportedMediaFile(fileName)) {
      rejected.push({ path: filePath, reason: 'UNSUPPORTED' })
      continue
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      rejected.push({ path: filePath, reason: 'UNREADABLE' })
      continue
    }

    const probe = await probeMedia(filePath).catch((error: unknown) => {
      console.warn(`[media-import] probe failed for ${fileName}:`, error)
      return null
    })

    const asset: MediaAsset = {
      id: randomId(),
      path: filePath,
      fileName,
      kind: 'video',
      fileSize: stat.size,
      fileMtimeMs: Math.round(stat.mtimeMs),
      durationMs: probe?.durationMs ?? 0,
      width: probe?.width,
      height: probe?.height,
      addedAt: Date.now(),
      transcriptStatus: 'none'
    }

    const updated = addAsset(projectId, asset)
    if (!updated) return null
    project = updated
    added.push(asset)
  }

  // A project still carrying the placeholder name takes the name of whatever
  // was imported first — nobody wants a library of "Untitled project".
  const first = added[0]
  if (first && project.name === DEFAULT_PROJECT_NAME) {
    project = renameProject(projectId, path.parse(first.fileName).name) ?? project
  }

  for (const asset of added) generateArtwork(projectId, asset)

  return { project, rejected }
}
