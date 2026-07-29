import type { ExportCodec } from '@logcut/core'
import { useCallback, useEffect, useState } from 'react'
import { errorMessageOf } from '@/lib/format'

/**
 * `choosing` is the native save dialog being up, and is deliberately distinct
 * from `running`: nothing is being rendered yet, so there is no progress to
 * show, and dismissing that dialog has to land back on `idle` rather than on
 * an outcome the user never asked for.
 */
export type ExportState =
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'running'; percent: number }
  | { kind: 'done'; savedPath: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

export interface ExportController {
  state: ExportState
  /** The codecs this build can produce; null until asked, empty when none. */
  codecs: ExportCodec[] | null
  start(): void
  cancel(): void
  /** Acknowledge an outcome and close the dialog. */
  dismiss(): void
}

export function useExport(projectId: string): ExportController {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })
  const [codecs, setCodecs] = useState<ExportCodec[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.logcut.getExportCapabilities().then((capabilities) => {
      if (!cancelled) setCodecs(capabilities.codecs)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.logcut.onExportProgress((progress) => {
      if (progress.projectId !== projectId) return
      // The first tick is main saying the save dialog is behind it and ffmpeg
      // has started; later ones only move the bar. A tick arriving after the
      // outcome must not drag a finished export back to running.
      setState((current) =>
        current.kind === 'choosing' || current.kind === 'running'
          ? { kind: 'running', percent: progress.percent }
          : current
      )
    })
  }, [projectId])

  const start = useCallback((): void => {
    setState({ kind: 'choosing' })
    void (async (): Promise<void> => {
      try {
        const result = await window.logcut.exportVideo(projectId)
        if (result.savedPath !== undefined) setState({ kind: 'done', savedPath: result.savedPath })
        else if (result.cancelled === true) setState({ kind: 'cancelled' })
        else setState({ kind: 'idle' })
      } catch (cause: unknown) {
        setState({ kind: 'failed', message: errorMessageOf(cause) })
      }
    })()
  }, [projectId])

  const cancel = useCallback((): void => {
    // The outcome still comes back through `start`'s await, as cancelled — this
    // only asks main to stop, it does not decide how the export ended.
    void window.logcut.cancelExport()
  }, [])

  const dismiss = useCallback((): void => setState({ kind: 'idle' }), [])

  return { state, codecs, start, cancel, dismiss }
}
