import type { JSX, ReactNode } from 'react'

/**
 * Every page carries its own title bar because the window has none of its own
 * on macOS (titleBarStyle: 'hiddenInset'). Two things follow from that and are
 * easy to lose: the strip must be draggable, or the window cannot be moved at
 * all, and its left edge must clear the traffic lights — handled by the
 * `titlebar` class, which only insets on macOS since Windows keeps a native
 * title bar.
 *
 * Interactive children must opt out of dragging with `no-drag`.
 */
export default function TitleBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <header className="titlebar flex h-12 shrink-0 items-center gap-stack border-b border-border pr-inset [-webkit-app-region:drag]">
      {children}
    </header>
  )
}
