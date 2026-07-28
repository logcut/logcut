import { Magnet, SquareSplitHorizontal } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isMac } from '@/lib/platform'

interface TimelineToolbarProps {
  onSplit(): void
  snapEnabled: boolean
  onToggleSnap(): void
}

/** Written the way the platform writes it, so it matches every other menu. */
const SPLIT_SHORTCUT = isMac ? '⌘B' : 'Ctrl+B'

/**
 * The strip of actions above the timeline.
 *
 * **The height is fixed, not derived from the buttons.** The timeline below is
 * sized in pixels by a drag, so a toolbar that grew with its contents would
 * take that height away every time an action is added.
 */
export default function TimelineToolbar({
  onSplit,
  snapEnabled,
  onToggleSnap
}: TimelineToolbarProps): JSX.Element {
  return (
    <div className="flex h-[var(--timeline-toolbar-height)] shrink-0 items-center gap-inline border-b border-border px-component">
      {/* Never disabled — the action declines instead, which is also the only
          thing the shortcut can do (see TimelineToolbar.md). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            // Says what it acts on, not just what it does: the playhead is the
            // argument, and nothing else on screen indicates that.
            aria-label="Split the subtitle at the playhead"
            onClick={onSplit}
          >
            <SquareSplitHorizontal />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Split ({SPLIT_SHORTCUT})</TooltipContent>
      </Tooltip>

      {/* A mode, not an action, so it stays lit while it is on — `quiet` gives
          that for free through aria-pressed (see components/ui/button.tsx). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-pressed={snapEnabled}
            aria-label="Snapping"
            onClick={onToggleSnap}
          >
            <Magnet />
          </Button>
        </TooltipTrigger>
        {/* Says what pressing it will do, not what is true now — the lit button
            already carries the state. */}
        <TooltipContent>
          {snapEnabled ? 'Turn off snapping (N)' : 'Turn on snapping (N)'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
