import type { JSX, ReactNode } from 'react'
import WindowControls from '@/components/WindowControls'
import { cn } from '@/lib/utils'

interface TitleBarProps {
  className?: string
  children: ReactNode
}

/**
 * Every page carries its own title bar because the window has none of its own
 * on macOS (titleBarStyle: 'hidden'). The consequence that is easy to lose:
 * the strip must be draggable, or the window cannot be moved at all.
 *
 * Height comes from --titlebar-height. On macOS the bar also carries the
 * window controls, drawn by us because AppKit's cannot be resized or
 * recoloured; WindowControls renders nothing on other platforms, where the
 * native title bar still owns them.
 *
 * Interactive children must opt out of dragging with `no-drag`.
 */
export default function TitleBar({ className, children }: TitleBarProps): JSX.Element {
  return (
    <header
      className={cn(
        'titlebar flex h-[var(--titlebar-height)] shrink-0 items-center gap-stack pr-inset [-webkit-app-region:drag]',
        className
      )}
    >
      <WindowControls />
      {children}
    </header>
  )
}
