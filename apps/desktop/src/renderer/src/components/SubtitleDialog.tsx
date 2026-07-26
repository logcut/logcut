import type { Utterance } from '@logcut/core'
import { Scissors, Search, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import type { JSX } from 'react'
import SubtitleList from '@/components/SubtitleList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SubtitleDialogProps {
  utterances: Utterance[]
  activeId: string | null
  canUndo: boolean
  onClose(): void
  onSeek(utterance: Utterance): void
  onEditSave(id: string, text: string): void
  onUndo(): void
  onResegment(): void
  onReplaceAll(find: string, replace: string): number
}

/**
 * Subtitle editing, opened by double-clicking a block on the timeline.
 *
 * Deliberately not a modal: playback continues underneath and the highlight
 * keeps following it, so this sits over the left panel only and leaves the
 * player untouched. A dimmed overlay would make watching-while-editing
 * impossible, which is the whole point of the panel.
 */
export default function SubtitleDialog({
  utterances,
  activeId,
  canUndo,
  onClose,
  onSeek,
  onEditSave,
  onUndo,
  onResegment,
  onReplaceAll
}: SubtitleDialogProps): JSX.Element {
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [message, setMessage] = useState('')

  const replaceAll = (): void => {
    const count = onReplaceAll(findText, replaceText)
    setMessage(
      count === 0 ? 'No matches.' : `Replaced ${count} occurrence${count === 1 ? '' : 's'}.`
    )
  }

  return (
    // Exactly as wide as the tab panel it covers, so the player keeps its full
    // width and playback stays watchable while editing.
    <div className="absolute inset-y-0 left-0 z-50 flex w-96 flex-col border-r border-border bg-card shadow-lg">
      <div className="flex shrink-0 items-center gap-component border-b border-border p-component">
        <span className="flex-1 text-label font-medium text-foreground">Subtitles</span>
        <Button variant="ghost" size="icon-sm" title="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} />
        </Button>
        <Button
          variant={findOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Find and replace"
          onClick={() => setFindOpen((open) => !open)}
        >
          <Search size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Re-split into lines" onClick={onResegment}>
          <Scissors size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Close" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      {findOpen && (
        <div className="flex shrink-0 items-center gap-component border-b border-border p-component">
          <Input
            placeholder="Find"
            value={findText}
            className="h-8"
            onChange={(event) => setFindText(event.target.value)}
          />
          <Input
            placeholder="Replace"
            value={replaceText}
            className="h-8"
            onChange={(event) => setReplaceText(event.target.value)}
          />
          <Button size="sm" disabled={findText === ''} onClick={replaceAll}>
            All
          </Button>
        </div>
      )}

      {message !== '' && (
        <p className="m-0 shrink-0 px-component pt-component text-caption font-normal text-muted-foreground">
          {message}
        </p>
      )}

      <SubtitleList
        utterances={utterances}
        activeId={activeId}
        onSelect={onSeek}
        onEditSave={onEditSave}
      />
    </div>
  )
}
