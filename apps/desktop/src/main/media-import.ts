import { randomId } from '@logcut/core'
import fs from 'node:fs'
import path from 'node:path'
import { isSupportedMediaFile } from '../shared/media'
import { extractPoster, probeMedia } from './ffmpeg'
import {
  addAsset,
  DEFAULT_PROJECT_NAME,
  loadProject,
  renameProject,
  thumbnailPath,
  updateAsset,
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
 * A poster is decoration. Failing to produce one must never surface as an
 * import error, so this runs detached and the card falls back to a placeholder.
 */
function generatePoster(projectId: string, asset: MediaAsset): void {
  if (asset.durationMs === 0) return
  const fileName = `${asset.id}.jpg`
  void extractPoster(
    asset.path,
    posterOffsetMs(asset.durationMs),
    thumbnailPath(projectId, fileName)
  )
    .then(() => {
      updateAsset(projectId, asset.id, { thumbnail: fileName })
    })
    .catch((error: unknown) => {
      console.warn(`[media-import] poster failed for ${asset.fileName}:`, error)
    })
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

  for (const asset of added) generatePoster(projectId, asset)

  return { project, rejected }
}
