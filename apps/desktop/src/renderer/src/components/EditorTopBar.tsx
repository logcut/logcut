import { Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import TitleBar from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface EditorTopBarProps {
  name: string
  onRename(name: string): void
  onOpenSettings(): void
}

/**
 * Sits directly on the page background — no border, no surface of its own —
 * so the panels below are the only things that read as cards.
 *
 * The title is absolutely centred rather than laid out in the flex row: the
 * row is padded on the left for the macOS traffic lights, which would push a
 * flow-positioned title off centre.
 */
export default function EditorTopBar({
  name,
  onRename,
  onOpenSettings
}: EditorTopBarProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  useEffect(() => {
    setDraft(name)
  }, [name])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== '' && next !== name) onRename(next)
    else setDraft(name)
  }

  return (
    <TitleBar className="relative">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            className="pointer-events-auto h-7 w-56 text-center text-caption [-webkit-app-region:no-drag]"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="pointer-events-auto max-w-sm cursor-text truncate text-caption font-medium text-foreground [-webkit-app-region:no-drag]"
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {name}
          </span>
        )}
      </div>

      <div className="flex flex-1 justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Settings"
          className="[-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
        </Button>
      </div>
    </TitleBar>
  )
}
