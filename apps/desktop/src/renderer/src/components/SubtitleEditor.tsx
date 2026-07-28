import type { Utterance } from '@logcut/core'
import { Scissors, Search, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import type { JSX } from 'react'
import SubtitleList from '@/components/SubtitleList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SubtitleEditorProps {
  utterances: Utterance[]
  activeId: string | null
  canUndo: boolean
  onClose(): void
  onSeek(utterance: Utterance): void
  onEditSave(id: string, text: string): void
  onTimeSave(id: string, edge: 'start' | 'end', timeMs: number): void
  onAdd(afterId: string): void
  onMerge(firstId: string): void
  speakerIds: string[]
  nextSpeakerId: string
  onSpeakerSave(id: string, speakerId: string): void
  onUndo(): void
  onResegment(): void
  onReplaceAll(find: string, replace: string): number
}

/**
 * Subtitle editing: the second face of the Subtitles tab, reached by
 * double-clicking a block on the timeline or by the button on the tab's form.
 *
 * It is the tab's *content*, not an overlay over the panel. As an overlay it
 * covered the tab strip too, and a panel that loses its own navigation reads
 * as a different, broken screen rather than as this panel in another mode.
 *
 * Nothing about it is modal: the player keeps its full width beside it and
 * playback carries on, which is the whole point — subtitles get fixed while
 * watching them.
 */
export default function SubtitleEditor({
  utterances,
  activeId,
  canUndo,
  onClose,
  onSeek,
  onEditSave,
  onTimeSave,
  onAdd,
  onMerge,
  speakerIds,
  nextSpeakerId,
  onSpeakerSave,
  onUndo,
  onResegment,
  onReplaceAll
}: SubtitleEditorProps): JSX.Element {
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
    // Fills the tab's content area; the Panel and the tab strip are above it.
    <div className="flex min-h-0 flex-1 flex-col">
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
            className="h-control-sm"
            onChange={(event) => setFindText(event.target.value)}
          />
          <Input
            placeholder="Replace"
            value={replaceText}
            className="h-control-sm"
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

      {/* Style settings — the appearance of the captions burned into the
          picture, which is a property of the whole track rather than of any one
          line. None of it is built yet, so this is a place, not yet a
          component: the height is whatever its contents come to, so the
          controls can arrive without a number here having to be revised.

          It sits above the list because a setting that governs every line
          should not be reached by scrolling past the lines it governs. */}
      <section className="shrink-0 border-b border-border p-component">
        <h2 className="m-0 mb-inline text-caption font-medium text-foreground">Style</h2>
        <p className="m-0 text-caption font-normal text-muted-foreground">
          Font, size, colour and position — not built yet.
        </p>
      </section>

      <SubtitleList
        utterances={utterances}
        activeId={activeId}
        onSeek={onSeek}
        onEditSave={onEditSave}
        onTimeSave={onTimeSave}
        onAdd={onAdd}
        onMerge={onMerge}
        speakerIds={speakerIds}
        nextSpeakerId={nextSpeakerId}
        onSpeakerSave={onSpeakerSave}
      />
    </div>
  )
}
