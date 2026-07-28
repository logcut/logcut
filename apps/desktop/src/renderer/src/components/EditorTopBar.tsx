import { ChevronLeft, PanelLeft, PanelRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import TitleBar from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface EditorTopBarProps {
  name: string
  chatOpen: boolean
  subtitlesOpen: boolean
  onBack(): void
  onRename(name: string): void
  onToggleChat(): void
  onToggleSubtitles(): void
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
  chatOpen,
  subtitlesOpen,
  onBack,
  onRename,
  onToggleChat,
  onToggleSubtitles
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
      {/* Sits right of the window controls: the only way back to the project
          list, since the title bar carries no other navigation. */}
      <Button
        variant="quiet"
        size="icon-lg"
        title="Back to projects"
        className="shrink-0 [-webkit-app-region:no-drag]"
        onClick={onBack}
      >
        <ChevronLeft />
      </Button>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            className="pointer-events-auto w-56 text-center text-caption [-webkit-app-region:no-drag]"
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

      {/* Both side columns are toggled from this end, each icon facing the side
          it controls, in the order the columns appear on screen. Settings used
          to sit here and is now in the application menu (see main/menu.ts): it
          belongs to the app, not to the project being edited, and a menu is
          where a desktop app keeps it.

          `aria-pressed` is both the state for assistive tech and what colours
          the icon while a column is showing. */}
      <div className="flex flex-1 justify-end">
        <Button
          variant="quiet"
          size="icon-lg"
          title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
          aria-pressed={chatOpen}
          className="[-webkit-app-region:no-drag]"
          onClick={onToggleChat}
        >
          <PanelLeft />
        </Button>

        <Button
          variant="quiet"
          size="icon-lg"
          title={subtitlesOpen ? 'Hide subtitle editor' : 'Show subtitle editor'}
          aria-pressed={subtitlesOpen}
          className="[-webkit-app-region:no-drag]"
          onClick={onToggleSubtitles}
        >
          <PanelRight />
        </Button>
      </div>
    </TitleBar>
  )
}
