import type { JSX } from 'react'
import type { CaptionApplyTarget } from '@/lib/caption-apply'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/** One line of English about what is in the way, built from two counts either of
 *  which may be zero. **Never called with both at zero** — the caller applies
 *  without asking in that case, and there would be nothing to say. */
function describe(lineCount: number, speakerCount: number): string {
  const parts: string[] = []
  if (lineCount > 0) parts.push(`${lineCount} line${lineCount === 1 ? '' : 's'}`)
  if (speakerCount > 0) parts.push(`${speakerCount} speaker${speakerCount === 1 ? '' : 's'}`)
  return `${parts.join(' and ')} ${
    lineCount + speakerCount === 1 ? 'has' : 'have'
  } styling of their own.`
}

/** The one question an Apply has to ask: whether it may take the narrower
 *  styling with it. Only shown when there is something to take — see
 *  lib/caption-apply.md. */
export default function ApplyStyleDialog({
  target,
  lineCount,
  speakerCount,
  onConfirm,
  onOpenChange
}: {
  /** Null when nothing is pending, which is also what closes the dialog. */
  target: CaptionApplyTarget | null
  lineCount: number
  speakerCount: number
  onConfirm(overwrite: boolean): void
  onOpenChange(open: boolean): void
}): JSX.Element {
  const where = target?.kind === 'speaker' ? `Speaker ${target.speakerId}` : 'all subtitles'

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply to {where}</DialogTitle>
          <DialogDescription>
            {describe(lineCount, speakerCount)} That styling wins over this, so keeping it leaves
            those subtitles looking exactly as they do now.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onConfirm(false)}>
            Keep them
          </Button>
          {/* The one that makes "all subtitles" true, so it is the primary. */}
          <Button onClick={() => onConfirm(true)}>Overwrite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
