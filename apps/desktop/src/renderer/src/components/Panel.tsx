import type { CSSProperties, JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelProps {
  className?: string
  /** For the one dimension a pane is dragged to; everything else is a class. */
  style?: CSSProperties
  children: ReactNode
}

/**
 * A surface floating on the page background — the editor's panes, and the
 * subtitle overlay that covers one of them.
 *
 * Deliberately not shadcn's Card. That one is a *content* card: it ships
 * `py-6 gap-6 border shadow-sm rounded-xl`, none of which a layout pane wants,
 * and stripping them would mean visual overrides at every call site, which
 * DESIGN.md forbids. This carries only what a pane actually needs — the
 * surface colour, the corner radius, and clipping so children cannot poke out
 * of the rounded corners.
 */
export default function Panel({ className, style, children }: PanelProps): JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-panel bg-card', className)} style={style}>
      {children}
    </div>
  )
}
