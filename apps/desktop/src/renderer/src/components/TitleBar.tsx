import type { JSX, ReactNode } from 'react'
import WindowControls from '@/components/WindowControls'
import { cn } from '@/lib/utils'

interface TitleBarProps {
  className?: string
  children: ReactNode
}

/** Every page carries its own title bar, the macOS window having none.
 *  **The strip must stay draggable, or the window cannot be moved at all** —
 *  interactive children opt out with `no-drag`. */
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
