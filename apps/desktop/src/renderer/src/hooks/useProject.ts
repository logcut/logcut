import type { TranscribeConfig, Transcript } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessageOf } from '@/lib/format'
import type { ProjectDetail, TranscribePhase } from '../../../shared/ipc'

export type AsrState =
  | { kind: 'idle' }
  | { kind: 'running'; phase: TranscribePhase }
  | { kind: 'failed'; message: string; apiKeyProblem: boolean }

/**
 * Everything the editor can change, as of one moment.
 *
 * Snapshots rather than inverse operations: transcripts are immutable, so an
 * entry costs a handful of references however long the transcript is, and
 * there is no per-command undo logic to get wrong. Two hundred entries of a
 * thousand-line transcript is still two hundred pointers.
 *
 * Recognition is **not** in here — see `record`.
 */
interface EditableState {
  transcripts: Record<string, Transcript | null>
  clips: { id: string; assetId: string }[]
}

/** Deep enough that nobody reaches the end by working; bounded so it cannot grow forever. */
const HISTORY_LIMIT = 200

function sameClips(a: EditableState['clips'], b: EditableState['clips']): boolean {
  return a.length === b.length && a.every((clip, index) => clip.id === b[index]?.id)
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
  canUndo: boolean
  canRedo: boolean
  importMedia(paths: string[]): Promise<void>
  removeMedia(assetId: string): Promise<void>
  /** Append an asset to the timeline. */
  addClip(assetId: string): Promise<void>
  /** Take clips off the timeline; the assets stay in the library. */
  removeClips(clipIds: string[]): Promise<void>
  rename(name: string): Promise<void>
  transcribe(assetId: string, config: TranscribeConfig, force?: boolean): Promise<void>
  /** Records history and persists; the single funnel for every subtitle edit. */
  applyTranscript(assetId: string, next: Transcript): void
  /** Same, for an edit spanning several assets — one history entry, not one each. */
  applyTranscripts(changes: { assetId: string; transcript: Transcript }[]): void
  undo(): void
  redo(): void
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
  const [past, setPast] = useState<EditableState[]>([])
  const [future, setFuture] = useState<EditableState[]>([])

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
  //
  // It deliberately does not clear the history: removing a clip is what makes
  // this run, and wiping here would take the undo for that very removal with
  // it. Undo saves to disk before it swaps the timeline, so the refetch this
  // triggers reads back exactly what was restored.
  useEffect(() => {
    let cancelled = false
    const ids = assetKey === '' ? [] : assetKey.split(',')
    if (ids.length === 0) {
      setTranscripts({})
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

  // Read through a ref so recording does not put the whole editable state in
  // every mutating callback's dependency list.
  const stateRef = useRef<EditableState>({ transcripts: {}, clips: [] })
  stateRef.current = {
    transcripts,
    clips: project?.timeline.map((clip) => ({ id: clip.id, assetId: clip.assetId })) ?? []
  }

  /** Push what is on screen now, and drop the redo branch it invalidates. */
  const record = useCallback((): void => {
    setPast((entries) => [...entries, stateRef.current].slice(-HISTORY_LIMIT))
    setFuture([])
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
    (assetId: string) => {
      record()
      return guard(() => window.logcut.addClip(projectId, assetId))
    },
    [guard, projectId, record]
  )

  // Sequential rather than parallel: each call returns the whole project, and
  // concurrent removals would each be computed from the same stale copy, so
  // the last answer back would put the others' clips right back.
  const removeClips = useCallback(
    (clipIds: string[]) => {
      record()
      return guard(async () => {
        let detail = await window.logcut.openProject(projectId)
        for (const clipId of clipIds) {
          detail = await window.logcut.removeClip(projectId, clipId)
        }
        return detail
      })
    },
    [guard, projectId, record]
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
        // Recognition wipes the history rather than joining it. Undoing it
        // would mean restoring "no transcript at all", which is a file that
        // has to be deleted rather than written, and every older entry
        // describes lines this run has just replaced.
        setPast([])
        setFuture([])
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

  /**
   * Write a state back to disk and to the screen.
   *
   * Only what actually differs is persisted: a transcript whose reference is
   * unchanged was not part of this step, and rewriting it would cost a file
   * write per undo per asset for nothing.
   */
  const restore = useCallback(
    async (target: EditableState): Promise<void> => {
      const current = stateRef.current
      for (const [assetId, transcript] of Object.entries(target.transcripts)) {
        if (transcript && transcript !== current.transcripts[assetId]) {
          await window.logcut.saveTranscript(projectId, assetId, transcript)
        }
      }
      setTranscripts(target.transcripts)
      if (!sameClips(target.clips, current.clips)) {
        setProject(await window.logcut.setTimeline(projectId, target.clips))
      }
    },
    [projectId]
  )

  const applyTranscripts = useCallback(
    (changes: { assetId: string; transcript: Transcript }[]): void => {
      if (changes.length === 0) return
      record()
      setTranscripts((current) => {
        const next = { ...current }
        for (const change of changes) next[change.assetId] = change.transcript
        return next
      })
      for (const change of changes) {
        void window.logcut.saveTranscript(projectId, change.assetId, change.transcript)
      }
    },
    [projectId, record]
  )

  const applyTranscript = useCallback(
    (assetId: string, next: Transcript): void => applyTranscripts([{ assetId, transcript: next }]),
    [applyTranscripts]
  )

  const undo = useCallback((): void => {
    const previous = past[past.length - 1]
    if (!previous) return
    setPast((entries) => entries.slice(0, -1))
    setFuture((entries) => [stateRef.current, ...entries])
    void restore(previous)
  }, [past, restore])

  const redo = useCallback((): void => {
    const next = future[0]
    if (!next) return
    setFuture((entries) => entries.slice(1))
    setPast((entries) => [...entries, stateRef.current].slice(-HISTORY_LIMIT))
    void restore(next)
  }, [future, restore])

  const exportSrt = useCallback(
    async (assetId: string): Promise<string | null> => {
      const result = await window.logcut.exportSrt(projectId, assetId)
      return result.savedPath ?? null
    },
    [projectId]
  )

  return {
    project,
    transcripts,
    loading,
    error,
    asr,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    importMedia,
    removeMedia,
    addClip,
    removeClips,
    rename,
    transcribe,
    applyTranscript,
    applyTranscripts,
    undo,
    redo,
    exportSrt
  }
}
