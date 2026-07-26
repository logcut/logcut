import type { TranscribeConfig, Transcript } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessageOf } from '@/lib/format'
import type { MediaAssetSummary, ProjectDetail, TranscribePhase } from '../../../shared/ipc'

export type AsrState =
  | { kind: 'idle' }
  | { kind: 'running'; phase: TranscribePhase }
  | { kind: 'failed'; message: string; apiKeyProblem: boolean }

export interface UseProjectResult {
  project: ProjectDetail | null
  activeAsset: MediaAssetSummary | null
  transcript: Transcript | null
  loading: boolean
  /** Failure to load or mutate the project itself, not the transcription. */
  error: string | null
  asr: AsrState
  canUndo: boolean
  importMedia(paths: string[]): Promise<void>
  removeMedia(assetId: string): Promise<void>
  setActiveMedia(assetId: string): Promise<void>
  rename(name: string): Promise<void>
  transcribe(config: TranscribeConfig, force?: boolean): Promise<void>
  /** Records an undo snapshot and persists; the single funnel for every edit. */
  applyTranscript(next: Transcript): void
  undo(): void
  exportSrt(): Promise<string | null>
}

/**
 * Owns everything about one open project: the detail record, the active
 * asset's transcript, and the transcription job. Every mutation goes through
 * here so the persisted state and what the editor shows cannot drift.
 */
export function useProject(projectId: string): UseProjectResult {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asr, setAsr] = useState<AsrState>({ kind: 'idle' })
  const [undoSnapshot, setUndoSnapshot] = useState<Transcript | null>(null)

  const activeAssetId = project?.activeAssetId ?? null
  const activeAsset = useMemo(
    () => project?.assets.find((asset) => asset.id === activeAssetId) ?? null,
    [project, activeAssetId]
  )

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

  // The transcript follows whichever asset is active, and is dropped when the
  // project has none.
  useEffect(() => {
    let cancelled = false
    if (activeAssetId === null) {
      setTranscript(null)
      setUndoSnapshot(null)
      return
    }
    window.logcut
      .getTranscript(projectId, activeAssetId)
      .then((stored) => {
        if (!cancelled) {
          setTranscript(stored)
          setUndoSnapshot(null)
        }
      })
      .catch(() => {
        if (!cancelled) setTranscript(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, activeAssetId])

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

  const setActiveMedia = useCallback(
    (assetId: string) => guard(() => window.logcut.setActiveMedia(projectId, assetId)),
    [guard, projectId]
  )

  const rename = useCallback(
    (name: string) => guard(() => window.logcut.renameProject(projectId, name)),
    [guard, projectId]
  )

  // Reading through a ref keeps transcribe out of every caller's dependency
  // list while still seeing the asset selected at click time.
  const activeAssetIdRef = useRef(activeAssetId)
  activeAssetIdRef.current = activeAssetId

  const transcribe = useCallback(
    async (config: TranscribeConfig, force = false): Promise<void> => {
      const assetId = activeAssetIdRef.current
      if (assetId === null) return
      setAsr({ kind: 'running', phase: 'extracting' })
      try {
        const result = await window.logcut.transcribeAsset(projectId, assetId, { force, config })
        setTranscript(result.transcript)
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
    (next: Transcript): void => {
      const assetId = activeAssetIdRef.current
      if (assetId === null) return
      setTranscript((current) => {
        setUndoSnapshot(current)
        return next
      })
      void window.logcut.saveTranscript(projectId, assetId, next)
    },
    [projectId]
  )

  const undo = useCallback((): void => {
    const assetId = activeAssetIdRef.current
    if (assetId === null || undoSnapshot === null) return
    const restored = undoSnapshot
    setUndoSnapshot(null)
    setTranscript(restored)
    void window.logcut.saveTranscript(projectId, assetId, restored)
  }, [projectId, undoSnapshot])

  const exportSrt = useCallback(async (): Promise<string | null> => {
    const assetId = activeAssetIdRef.current
    if (assetId === null) return null
    const result = await window.logcut.exportSrt(projectId, assetId)
    return result.savedPath ?? null
  }, [projectId])

  return {
    project,
    activeAsset,
    transcript,
    loading,
    error,
    asr,
    canUndo: undoSnapshot !== null,
    importMedia,
    removeMedia,
    setActiveMedia,
    rename,
    transcribe,
    applyTranscript,
    undo,
    exportSrt
  }
}
