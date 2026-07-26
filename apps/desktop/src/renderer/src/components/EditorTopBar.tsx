import { ArrowLeft, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import TitleBar from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface EditorTopBarProps {
  name: string
  onBack(): void
  onRename(name: string): void
  onOpenSettings(): void
}

export default function EditorTopBar({
  name,
  onBack,
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
    <TitleBar>
      <Button
        variant="ghost"
        size="sm"
        className="[-webkit-app-region:no-drag]"
        onClick={onBack}
        title="Back to projects"
      >
        <ArrowLeft size={16} />
        Projects
      </Button>

      {editing ? (
        <Input
          autoFocus
          value={draft}
          className="h-8 max-w-xs [-webkit-app-region:no-drag]"
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
          className="min-w-0 flex-1 cursor-text truncate text-label font-medium text-foreground [-webkit-app-region:no-drag]"
          title="Double-click to rename"
          onDoubleClick={() => setEditing(true)}
        >
          {name}
        </span>
      )}

      {editing && <span className="flex-1" />}

      <Button
        variant="ghost"
        size="icon-sm"
        title="Settings"
        className="[-webkit-app-region:no-drag]"
        onClick={onOpenSettings}
      >
        <Settings size={16} />
      </Button>
    </TitleBar>
  )
}
