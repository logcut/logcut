import { Clapperboard, Plus, Settings } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'

export type View = 'import' | 'media' | 'settings'

interface SidebarProps {
  view: View
  onSelect(view: View): void
}

const NAV_ITEMS: { view: View; label: string; Icon: typeof Clapperboard }[] = [
  { view: 'import', label: 'Import', Icon: Plus },
  { view: 'media', label: 'Media', Icon: Clapperboard },
  { view: 'settings', label: 'Settings', Icon: Settings }
]

export default function Sidebar({ view, onSelect }: SidebarProps): JSX.Element {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 [-webkit-app-region:drag]">
      {/* Clears the macOS traffic lights, which overlap the top-left corner. */}
      <div className="mt-6 flex h-12 items-center gap-2 px-2">
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-md"
        >
          <defs>
            <linearGradient id="logo-grade" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#2FB5A8" />
              <stop offset="1" stopColor="#E8833A" />
            </linearGradient>
          </defs>
          <path d="M0 0 H36 L22.7 64 H0 Z" fill="#8A9096" />
          <path d="M41.3 0 H64 V64 H28 Z" fill="url(#logo-grade)" />
        </svg>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">LogCut</span>
          <span className="text-xs text-muted-foreground">AI video editor</span>
        </div>
      </div>
      <nav className="mt-2 flex flex-col gap-1">
        {NAV_ITEMS.map(({ view: itemView, label, Icon }) => (
          <Button
            key={itemView}
            variant={view === itemView ? 'default' : 'ghost'}
            size="sm"
            className="w-full justify-start [-webkit-app-region:no-drag]"
            onClick={() => onSelect(itemView)}
          >
            <Icon size={16} className="shrink-0" />
            <span>{label}</span>
          </Button>
        ))}
      </nav>
    </aside>
  )
}
