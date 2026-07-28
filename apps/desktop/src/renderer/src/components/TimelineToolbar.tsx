import { SquareSplitHorizontal } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

interface TimelineToolbarProps {
  /** False when the playhead is not inside a subtitle, or not between two of
   *  its words — there is nothing to cut in either case. */
  canSplit: boolean
  onSplit(): void
}

/**
 * The strip of actions above the timeline: things done *to* what the playhead
 * is on, as opposed to the panels beside the picture, which are settings.
 *
 * Its height is fixed rather than derived from the buttons, because the
 * timeline below is sized in pixels by a drag — a toolbar that grew with its
 * contents would change how much timeline is showing every time an action is
 * added to it.
 */
export default function TimelineToolbar({ canSplit, onSplit }: TimelineToolbarProps): JSX.Element {
  return (
    <div className="flex h-[var(--timeline-toolbar-height)] shrink-0 items-center gap-inline border-b border-border px-component">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!canSplit}
        // Says what it acts on, not just what it does: the playhead is the
        // argument, and nothing else on screen indicates that.
        title="Split the subtitle at the playhead"
        onClick={onSplit}
      >
        <SquareSplitHorizontal />
      </Button>
    </div>
  )
}
