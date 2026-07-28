import { applyCommands, DEFAULT_CAPTION_STYLES } from '@logcut/core'
import type {
  CaptionStyles,
  CommandResult,
  EditCommand,
  EditDocument,
  TranscribeConfig,
  Transcript
} from '@logcut/core'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** In the undo history, not in settings — see useProject.md. */
  captionStyles: CaptionStyles
}

/** Deep enough that nobody reaches the end by working; bounded so it cannot grow forever. */
const HISTORY_LIMIT = 200

function sameClips(a: EditableState['clips'], b: EditableState['clips']): boolean {
  return a.length === b.length && a.every((clip, index) => clip.id === b[index]?.id)
}

/**
 * Drop the assets that have no transcript yet.
 *
 * On screen "not recognized" and "recognized" share one map, with null for the
 * former, because the editor has to render both. The core takes only the ones
 * that exist: a command naming an absent asset reports no change, which is the
 * same answer without a null to carry through every signature.
 */
function present(transcripts: Record<string, Transcript | null>): Record<string, Transcript> {
  const kept: Record<string, Transcript> = {}
  for (const [assetId, transcript] of Object.entries(transcripts)) {
    if (transcript) kept[assetId] = transcript
  }
  return kept
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
  /**
   * Set the longest subtitle line and re-split every transcript that can be.
   * Local and free — unlike `transcribe` it spends no API credit. Resolves to
   * the asset ids left alone for want of an archived provider response.
   */
  setMaxChars(maxChars: number): Promise<string[]>
  /**
   * Change how the captions look. Joins the undo history, because these are
   * dragged and rotated on the picture and an object moved on a canvas is
   * expected to come back with Cmd+Z.
   *
   * `record: false` for the middle of a gesture: a drag writes on every frame,
   * and recording each one would bury the history under a single movement.
   * The first frame records, the rest do not.
   */
  setCaptionStyles(styles: CaptionStyles, options?: { record?: boolean }): Promise<void>
  /**
   * The single funnel for every edit: applies a batch, records one history entry,
   * persists what changed, hands the outcomes back.
   *
   * **A batch is the unit, never a single command** — an assistant's turn is
   * several commands and must undo as one (see useProject.md).
   */
  dispatch(commands: EditCommand[], options?: { record?: boolean }): CommandResult
  /**
   * The document the core sees, for callers that read rather than edit — the
   * agent bridge queries against exactly what a command would be applied to.
   * A function rather than a value: it is read at the moment of the question,
   * not captured when a component last rendered.
   */
  doc(): EditDocument
  undo(): void
  redo(): void
  exportSrt(assetId: string): Promise<string | null>
}

/** Owns one open project: its detail record, the transcripts of whatever is on
 *  the timeline, and the transcription job. **Every mutation goes through
 *  here**, so what is persisted and what is shown cannot drift. */
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
  const stateRef = useRef<EditableState>({
    transcripts: {},
    clips: [],
    captionStyles: DEFAULT_CAPTION_STYLES
  })
  stateRef.current = {
    transcripts,
    clips: project?.timeline.map((clip) => ({ id: clip.id, assetId: clip.assetId })) ?? [],
    captionStyles: project?.captionStyles ?? DEFAULT_CAPTION_STYLES
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

  const setCaptionStyles = useCallback(
    // Through `guard` like every other mutation: on its own it swallowed
    // failures whole. The caller fires it with `void`, so a rejection here
    // surfaces nowhere at all — the font simply would not change and nothing
    // would say why.
    (styles: CaptionStyles, options: { record?: boolean } = {}) => {
      if (options.record !== false) record()
      // On screen first, disk second. The caption is dragged on the picture,
      // and waiting for a round trip to the main process before showing the
      // result would flash the old position for a frame on release. Main
      // normalizes what it stores and returns it, so the value below is
      // replaced by the authoritative one a moment later — the two agree
      // unless something was out of range, in which case the clamped value
      // wins, which is also the right answer.
      setProject((current) => (current ? { ...current, captionStyles: styles } : current))
      return guard(() => window.logcut.setCaptionStyles(projectId, styles))
    },
    [guard, projectId, record]
  )

  /**
   * Change the longest subtitle line and re-split what can be re-split.
   *
   * **Clears the history rather than joining it**: every older entry describes
   * lines that no longer exist, and main has already written the new ones.
   *
   * Returns the assets left alone for want of an archived provider response, so
   * the caller can name them instead of letting the user wonder.
   */
  const setMaxChars = useCallback(
    async (maxChars: number): Promise<string[]> => {
      const result = await window.logcut.setMaxChars(projectId, maxChars)
      setTranscripts((current) => ({ ...current, ...result.transcripts }))
      setPast([])
      setFuture([])
      setProject(result.project)
      return result.skipped
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
      // Compared by reference: every write produces a new object, so an
      // unchanged reference means this step did not touch the styling and the
      // project file should not be rewritten for it.
      if (target.captionStyles !== current.captionStyles) {
        setProject(await window.logcut.setCaptionStyles(projectId, target.captionStyles))
      }
    },
    [projectId]
  )

  /**
   * Run a batch of commands and land the result.
   *
   * The document handed to the core is read off the ref rather than taken as a
   * dependency, so this callback is stable — every subtitle row holds a handler
   * that ends up here, and those rows are memoized.
   *
   * Only assets the batch actually changed are written: `changed` is the core's
   * answer to that question, and rewriting the rest would cost a file write per
   * edit per asset for nothing.
   */
  const doc = useCallback(
    (): EditDocument => ({ transcripts: present(stateRef.current.transcripts) }),
    []
  )

  const dispatch = useCallback(
    (commands: EditCommand[], options: { record?: boolean } = {}): CommandResult => {
      const result = applyCommands(doc(), commands)
      if (result.changed.length === 0) return result

      // A caption dragged on the picture dispatches on every frame; only the
      // first of them is a step worth going back to.
      if (options.record !== false) record()
      const changes = result.changed.flatMap((assetId) => {
        const transcript = result.doc.transcripts[assetId]
        return transcript ? [{ assetId, transcript }] : []
      })
      setTranscripts((current) => {
        const next = { ...current }
        for (const change of changes) next[change.assetId] = change.transcript
        return next
      })
      for (const change of changes) {
        void window.logcut.saveTranscript(projectId, change.assetId, change.transcript)
      }
      return result
    },
    [doc, projectId, record]
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
    setMaxChars,
    setCaptionStyles,
    dispatch,
    doc,
    undo,
    redo,
    exportSrt
  }
}
