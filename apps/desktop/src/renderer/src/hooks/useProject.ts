import type { TranscribeConfig, Transcript } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessageOf } from '@/lib/format'
import type { ProjectDetail, TranscribePhase } from '../../../shared/ipc'

export type AsrState =
  | { kind: 'idle' }
  | { kind: 'running'; phase: TranscribePhase }
  | { kind: 'failed'; message: string; apiKeyProblem: boolean }

/** An edit that can be taken back, and the asset it belongs to. */
interface UndoSnapshot {
  assetId: string
  transcript: Transcript | null
}

export interface UseProjectResult {
  project: ProjectDetail | null
  /**
   * Transcripts of every asset on the timeline, by asset id. Several clips can
   * be laid down at once and each carries its own subtitles, so this cannot be
   * the single transcript it used to be.
   */
  transcripts: Record<string, Transcript | null>
  loading: boolean
  /** Failure to load or mutate the project itself, not the transcription. */
  error: string | null
  asr: AsrState
  /** The asset the undoable edit belongs to; null when there is nothing to undo. */
  undoableAssetId: string | null
  importMedia(paths: string[]): Promise<void>
  removeMedia(assetId: string): Promise<void>
  /** Append an asset to the timeline. */
  addClip(assetId: string): Promise<void>
  /** Take one clip off the timeline; the asset stays in the library. */
  /** Take clips off the timeline; the assets stay in the library. */
  removeClips(clipIds: string[]): Promise<void>
  rename(name: string): Promise<void>
  transcribe(assetId: string, config: TranscribeConfig, force?: boolean): Promise<void>
  /** Records an undo snapshot and persists; the single funnel for every edit. */
  applyTranscript(assetId: string, next: Transcript): void
  undo(): void
  exportSrt(assetId: string): Promise<string | null>
}

/**
 * Owns everything about one open project: the detail record, the transcripts
 * of whatever is on the timeline, and the transcription job. Every mutation
 * goes through here so the persisted state and what the editor shows cannot
 * drift.
 */
export function useProject(projectId: string): UseProjectResult {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [transcripts, setTranscripts] = useState<Record<string, Transcript | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asr, setAsr] = useState<AsrState>({ kind: 'idle' })
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)

  // Distinct because the same asset may be laid down more than once, and a
  // joined key because an array identity would re-fetch on every render.
  const timelineAssetIds = project?.timeline.map((clip) => clip.assetId) ?? []
  const assetKey = [...new Set(timelineAssetIds)].sort().join(',')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.logcut
      .openProject(projectId)
      .then((detail) => {
        if (!cancelled) setProject(detail)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessageOf(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // One fetch per asset on the timeline, replacing the map wholesale so a clip
  // that was removed does not leave its transcript behind.
  useEffect(() => {
    let cancelled = false
    const ids = assetKey === '' ? [] : assetKey.split(',')
    if (ids.length === 0) {
      setTranscripts({})
      setUndoSnapshot(null)
      return
    }
    Promise.all(
      ids.map((assetId) =>
        window.logcut
          .getTranscript(projectId, assetId)
          .then((stored) => [assetId, stored] as const)
          .catch(() => [assetId, null] as const)
      )
    )
      .then((entries) => {
        if (cancelled) return
        setTranscripts(Object.fromEntries(entries))
        setUndoSnapshot(null)
      })
      .catch(() => {
        /* every fetch already falls back to null */
      })
    return () => {
      cancelled = true
    }
  }, [projectId, assetKey])

  // Artwork is produced in the background long after openProject resolved.
  useEffect(() => {
    return window.logcut.onProjectUpdated((updatedId) => {
      if (updatedId !== projectId) return
      window.logcut
        .openProject(projectId)
        .then(setProject)
        .catch(() => {
          /* the project may have been deleted meanwhile */
        })
    })
  }, [projectId])

  useEffect(() => {
    return window.logcut.onTranscribeProgress((progress) => {
      if (progress.projectId !== projectId) return
      setAsr((current) =>
        current.kind === 'running' ? { kind: 'running', phase: progress.phase } : current
      )
    })
  }, [projectId])

  const guard = useCallback(async (action: () => Promise<ProjectDetail>): Promise<void> => {
    try {
      setProject(await action())
      setError(null)
    } catch (cause: unknown) {
      setError(errorMessageOf(cause))
    }
  }, [])

  const importMedia = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      try {
        const result = await window.logcut.importMedia(projectId, paths)
        setProject(result.project)
        setError(
          result.rejected.length > 0
            ? `Could not import ${result.rejected.length} file${result.rejected.length === 1 ? '' : 's'}.`
            : null
        )
      } catch (cause: unknown) {
        setError(errorMessageOf(cause))
      }
    },
    [projectId]
  )

  const removeMedia = useCallback(
    (assetId: string) => guard(() => window.logcut.removeMedia(projectId, assetId)),
    [guard, projectId]
  )

  const addClip = useCallback(
    (assetId: string) => guard(() => window.logcut.addClip(projectId, assetId)),
    [guard, projectId]
  )

  // Sequential rather than parallel: each call returns the whole project, and
  // concurrent removals would each be computed from the same stale copy, so
  // the last answer back would put the others' clips right back.
  const removeClips = useCallback(
    (clipIds: string[]) =>
      guard(async () => {
        let detail = await window.logcut.openProject(projectId)
        for (const clipId of clipIds) {
          detail = await window.logcut.removeClip(projectId, clipId)
        }
        return detail
      }),
    [guard, projectId]
  )

  const rename = useCallback(
    (name: string) => guard(() => window.logcut.renameProject(projectId, name)),
    [guard, projectId]
  )

  const transcribe = useCallback(
    async (assetId: string, config: TranscribeConfig, force = false): Promise<void> => {
      setAsr({ kind: 'running', phase: 'extracting' })
      try {
        const result = await window.logcut.transcribeAsset(projectId, assetId, { force, config })
        setTranscripts((current) => ({ ...current, [assetId]: result.transcript }))
        setUndoSnapshot(null)
        setAsr({ kind: 'idle' })
        // transcriptStatus lives on the asset, so the project record is stale now.
        setProject(await window.logcut.openProject(projectId))
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setAsr({
          kind: 'failed',
          message: errorMessageOf(cause),
          apiKeyProblem: message.includes('API_KEY_')
        })
      }
    },
    [projectId]
  )

  const applyTranscript = useCallback(
    (assetId: string, next: Transcript): void => {
      setTranscripts((current) => {
        setUndoSnapshot({ assetId, transcript: current[assetId] ?? null })
        return { ...current, [assetId]: next }
      })
      void window.logcut.saveTranscript(projectId, assetId, next)
    },
    [projectId]
  )

  const undo = useCallback((): void => {
    if (!undoSnapshot) return
    const { assetId, transcript } = undoSnapshot
    setUndoSnapshot(null)
    setTranscripts((current) => ({ ...current, [assetId]: transcript }))
    if (transcript) void window.logcut.saveTranscript(projectId, assetId, transcript)
  }, [projectId, undoSnapshot])

  const exportSrt = useCallback(
    async (assetId: string): Promise<string | null> => {
      const result = await window.logcut.exportSrt(projectId, assetId)
      return result.savedPath ?? null
    },
    [projectId]
  )

  const undoableAssetId = useMemo(() => undoSnapshot?.assetId ?? null, [undoSnapshot])

  return {
    project,
    transcripts,
    loading,
    error,
    asr,
    undoableAssetId,
    importMedia,
    removeMedia,
    addClip,
    removeClips,
    rename,
    transcribe,
    applyTranscript,
    undo,
    exportSrt
  }
}
