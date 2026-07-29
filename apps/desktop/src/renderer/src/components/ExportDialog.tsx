import { formatTimecode } from '@logcut/core'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import type { ExportState } from '@/hooks/useExport'

interface ExportDialogProps {
  state: ExportState
  /** Length of the timeline being exported. */
  durationMs: number
  /** How many captions will be burned in; zero means the film is remuxed. */
  captionCount: number
  onCancel(): void
  onDismiss(): void
}

function title(state: ExportState): string {
  switch (state.kind) {
    case 'running':
      return 'Exporting'
    case 'done':
      return 'Export complete'
    case 'cancelled':
      return 'Export cancelled'
    case 'failed':
      return 'Export failed'
    case 'idle':
    case 'choosing':
      return ''
  }
}

/**
 * The progress and outcome of a video export.
 *
 * A dialog rather than a page or a bar somewhere, for the reason the settings
 * dialog is one: a route of its own would unmount the editor and take the
 * playhead, the scroll position and the open tab with it (see ExportDialog.md).
 */
export default function ExportDialog({
  state,
  durationMs,
  captionCount,
  onCancel,
  onDismiss
}: ExportDialogProps): JSX.Element {
  const running = state.kind === 'running'
  const open =
    running || state.kind === 'done' || state.kind === 'cancelled' || state.kind === 'failed'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !running && onDismiss()}>
      <DialogContent
        showCloseButton={!running}
        // Esc and a click outside are the two ways a modal is usually left, and
        // both would leave the export running with nothing on screen saying so.
        onEscapeKeyDown={(event) => running && event.preventDefault()}
        onInteractOutside={(event) => running && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title(state)}</DialogTitle>
          <DialogDescription>
            {formatTimecode(durationMs)}
            {captionCount > 0
              ? ` · ${captionCount} captions burned in`
              : ' · no captions to burn, copying the picture through'}
          </DialogDescription>
        </DialogHeader>

        {running && (
          <div className="flex flex-col gap-component">
            <Progress value={state.percent} />
            <span className="text-caption font-normal text-muted-foreground">
              {Math.floor(state.percent)}%
            </span>
          </div>
        )}
        {state.kind === 'done' && (
          <p className="m-0 break-all text-caption font-normal text-muted-foreground">
            {state.savedPath}
          </p>
        )}
        {state.kind === 'failed' && (
          <p className="m-0 break-all text-caption font-normal text-muted-foreground">
            {state.message}
          </p>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button onClick={onDismiss}>{state.kind === 'done' ? 'Done' : 'Close'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
