import { applyCommands, DEFAULT_CAPTION_STYLES } from '@logcut/core'
import type {
  CaptionStyles,
  CommandResult,
  EditCommand,
  EditDocument,
  ExportSettings,
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

/** Everything the editor can change, as of one moment. **Snapshots rather than
 *  inverse operations** — transcripts are immutable, so an entry costs a
 *  handful of references however long they are (see useProject.md). */
interface EditableState {
  transcripts: Record<string, Transcript | null>
  clips: { id: string; assetId: string }[]
  /** In the undo history, not in settings — see useProject.md. */
  captionStyles: CaptionStyles
}

/** Deep enough that nobody reaches the end by working; bounded so it cannot grow forever. */
/**
 * One step back, and what it took to get here.
 *
 * **`batch` is null for the steps that are not commands** — adding a clip,
 * resetting the project-wide caption styles. Undo has to move the edit log in
 * step with itself, and only a step that appended to the log may take something
 * off it (see useProject.md).
 */
interface HistoryEntry {
  state: EditableState
  batch: EditCommand[] | null
}

const HISTORY_LIMIT = 200

/** How long the log sits still before it is written. Long enough that a run of
 *  keystrokes is one write, short enough that a crash loses nothing anyone
 *  would notice. */
const LOG_SAVE_DELAY_MS = 500

function sameClips(a: EditableState['clips'], b: EditableState['clips']): boolean {
  return a.length === b.length && a.every((clip, index) => clip.id === b[index]?.id)
}

/** Drop the assets that have no transcript yet: the editor needs one map with
 *  nulls in it, the core takes only what exists. */
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
  /** Change how the captions look. Joins the undo history — these are dragged
   *  on the picture. **`record: false` for the middle of a gesture**: the first
   *  frame records, the rest do not (see useProject.md). */
  setCaptionStyles(styles: CaptionStyles, options?: { record?: boolean }): Promise<void>
  /**
   * The single funnel for every edit: applies a batch, records one history entry,
   * persists what changed, hands the outcomes back.
   *
   * **A batch is the unit, never a single command** — an assistant's turn is
   * several commands and must undo as one (see useProject.md).
   */
  dispatch(commands: EditCommand[], options?: { record?: boolean }): CommandResult
  /** The document the core sees, for callers that read rather than edit. **A
   *  function rather than a value**: read at the moment of the question, not
   *  captured when a component last rendered. */
  doc(): EditDocument
  undo(): void
  redo(): void
  exportSrt(assetId: string): Promise<string | null>
  /** Remember how this project is exported. Not an undoable edit: it changes
   *  what the next export produces, not the cut itself. */
  setExportSettings(settings: ExportSettings): Promise<void>
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
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  /**
   * Every batch applied to this project, oldest first — **the edit as a list of
   * intentions rather than a list of states**. Replaying it onto the base
   * transcript reproduces what is on disk; that is checked by `verifyHistory`
   * (see packages/core/src/commands/index.md).
   *
   * Unbounded, unlike the undo stack above: dropping the oldest step is fine for
   * "how far back can I go" and fatal for "rebuild this project".
   */
  const [log, setLog] = useState<EditCommand[][]>([])
  /** Batches taken off `log` by undo, newest first, waiting for redo. */
  const [redoLog, setRedoLog] = useState<EditCommand[][]>([])
  /** False until the stored log has arrived, so the empty one on screen in the
   *  meantime is never written over it — the same guard the layout uses. */
  const [logLoaded, setLogLoaded] = useState(false)

  // Distinct because the same asset may be laid down more than once, and a
  // joined key because an array identity would re-fetch on every render.
  const timelineAssetIds = project?.timeline.map((clip) => clip.assetId) ?? []
  const assetKey = [...new Set(timelineAssetIds)].sort().join(',')

  // The stored edit log, read once alongside the project itself.
  useEffect(() => {
    let cancelled = false
    setLogLoaded(false)
    void window.logcut.loadHistory(projectId).then((batches) => {
      if (cancelled) return
      setLog(batches)
      setRedoLog([])
      setLogLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // **Written whole on every change, on a debounce**: undo takes batches back
  // off the end, so this is never an append (see main/projects.md). The gate is
  // what stops the empty log on screen during loading from erasing the stored
  // one.
  useEffect(() => {
    if (!logLoaded) return
    const timer = setTimeout(
      () => void window.logcut.saveHistory(projectId, log),
      LOG_SAVE_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [log, logLoaded, projectId])

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

  // Replaces the map wholesale so a removed clip leaves no transcript behind.
  // **It deliberately does not clear the history**: removing a clip is what
  // makes this run, and wiping here would take the undo for that very removal
  // with it. Undo saves to disk before it swaps the timeline, so the refetch
  // this triggers reads back exactly what was restored.
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

  /** Push what is on screen now, and drop the redo branch it invalidates.
   *  `batch` is what this step is about to apply, or null when the step is not
   *  a command at all. */
  const record = useCallback((batch: EditCommand[] | null = null): void => {
    setPast((entries) => [...entries, { state: stateRef.current, batch }].slice(-HISTORY_LIMIT))
    setFuture([])
    setRedoLog([])
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
        // **Recognition wipes the history rather than joining it** — undoing it
        // would mean restoring "no transcript at all", a file that has to be
        // deleted rather than written (see useProject.md).
        setPast([])
        setFuture([])
        // The log goes with it, and for a stronger reason than the undo stack's:
        // recognition writes a new base transcript, so every batch already
        // recorded names lines that no longer exist (see main/projects.md).
        setLog([])
        setRedoLog([])
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
    // Not through `guard`, unlike every other mutation, and the reason is the
    // line marked below. Errors are still surfaced — swallowing them was what
    // made a rejected write show up nowhere at all, the caller firing this
    // with `void`.
    async (styles: CaptionStyles, options: { record?: boolean } = {}): Promise<void> => {
      if (options.record !== false) record()
      // On screen first, disk second. The caption is dragged on the picture,
      // and waiting for a round trip to the main process before showing the
      // result would flash the old position for a frame on release.
      setProject((current) => (current ? { ...current, captionStyles: styles } : current))
      try {
        const detail = await window.logcut.setCaptionStyles(projectId, styles)
        // **Only the styling comes back out of the reply**, and compared rather
        // than assigned. Adopting the whole project replaces `timeline` and
        // `assets` with freshly deserialized arrays, which re-runs
        // `layUtterances` over every subtitle once per frame of a colour drag —
        // for a field neither of them contains. The comparison still lets main's
        // normalization win when it actually changed something.
        setProject((current) =>
          current && JSON.stringify(current.captionStyles) !== JSON.stringify(detail.captionStyles)
            ? { ...current, captionStyles: detail.captionStyles }
            : current
        )
        setError(null)
      } catch (cause: unknown) {
        setError(errorMessageOf(cause))
      }
    },
    [projectId, record]
  )

  const setExportSettings = useCallback(
    (settings: ExportSettings) => guard(() => window.logcut.setExportSettings(projectId, settings)),
    [guard, projectId]
  )

  /** **Clears the history rather than joining it**: every older entry describes
   *  lines that no longer exist. Returns the assets left alone for want of an
   *  archived provider response. */
  const setMaxChars = useCallback(
    async (maxChars: number): Promise<string[]> => {
      const result = await window.logcut.setMaxChars(projectId, maxChars)
      setTranscripts((current) => ({ ...current, ...result.transcripts }))
      setPast([])
      setFuture([])
      // Main has already cleared the stored log and written a new base; this
      // keeps the copy in hand from writing the old one back over it.
      setLog([])
      setRedoLog([])
      setProject(result.project)
      return result.skipped
    },
    [projectId]
  )

  /** Write a state back to disk and to the screen. **Only what actually differs
   *  is persisted** — an unchanged reference was not part of this step. */
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
      if (options.record !== false) {
        record(commands)
        setLog((entries) => [...entries, commands])
      } else {
        // The middle of a gesture: it continues the step already recorded, so
        // it replaces that step's batch instead of adding one. Without this a
        // four-second drag would leave hundreds of batches in the log, and
        // replaying them would walk the caption across the picture again.
        setLog((entries) =>
          entries.length === 0 ? [commands] : [...entries.slice(0, -1), commands]
        )
      }
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
    setFuture((entries) => [{ state: stateRef.current, batch: previous.batch }, ...entries])
    // Only a step that put a batch on the log takes one off it. The undo stack
    // also holds steps that are not commands at all.
    if (previous.batch) {
      setLog((entries) => entries.slice(0, -1))
      setRedoLog((entries) => [previous.batch as EditCommand[], ...entries])
    }
    void restore(previous.state)
  }, [past, restore])

  const redo = useCallback((): void => {
    const next = future[0]
    if (!next) return
    setFuture((entries) => entries.slice(1))
    setPast((entries) =>
      [...entries, { state: stateRef.current, batch: next.batch }].slice(-HISTORY_LIMIT)
    )
    // The mirror of undo: the batch it took off the log goes back on, in the
    // order it was applied the first time.
    if (next.batch) {
      setLog((entries) => [...entries, next.batch as EditCommand[]])
      setRedoLog((entries) => entries.slice(1))
    }
    void restore(next.state)
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
    exportSrt,
    setExportSettings
  }
}
