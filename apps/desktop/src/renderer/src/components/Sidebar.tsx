import { Clapperboard, Plus, Settings } from 'lucide-react'
import type { JSX } from 'react'
import logoUrl from '@assets/logo.svg'
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
        {/* Decorative: the adjacent text already names the product. */}
        <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md" />
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
