import type { CSSProperties, JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelProps {
  className?: string
  /** For the one dimension a pane is dragged to; everything else is a class. */
  style?: CSSProperties
  children: ReactNode
}

/** A surface floating on the page background. **Deliberately not shadcn's
 *  Card** — that is a content card, and stripping its padding and border would
 *  mean visual overrides at every call site (see Panel.md). */
export default function Panel({ className, style, children }: PanelProps): JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-panel bg-card', className)} style={style}>
      {children}
    </div>
  )
}
