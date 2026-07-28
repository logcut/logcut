import type { CaptionStyle, Utterance } from '@logcut/core'
import { Search, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import type { JSX } from 'react'
import SubtitleList from '@/components/SubtitleList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useCaptionFonts } from '@/hooks/useCaptionFonts'

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
  onReplaceAll(find: string, replace: string): number
  /** The project-wide caption style, already resolved. */
  style: CaptionStyle
  onFontChange(fontFamily: string): void
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
  onReplaceAll,
  style,
  onFontChange
}: SubtitleEditorProps): JSX.Element {
  const fonts = useCaptionFonts()
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
          picture. It sits above the list because a setting that governs every
          line should not be reached by scrolling past the lines it governs.

          Everything here writes `base`, the whole project's captions. The
          stored shape already carries per-speaker and per-line overrides and
          resolves them (see packages/core/src/caption-style.ts); offering them
          is UI work, not another change to what is on disk. */}
      {/* A fixed 40% of the column, not the height of its contents. Size,
          colour, spacing and alignment are still to come, and a section that
          grew with each one would move the subtitle list down every time —
          the list is what the eye returns to, so its top edge stays put.

          A layout proportion rather than a spacing value, which is why it is a
          bare percentage: no spacing token could express it, and the timeline
          split above uses the same 40% for the same kind of reason. It scrolls,
          so the controls are reachable before the section is tall enough. */}
      <section className="h-[40%] shrink-0 overflow-y-auto border-b border-border p-component">
        <h2 className="m-0 mb-component text-caption font-medium text-foreground">Style</h2>
        <div className="flex items-center gap-component">
          <span className="w-12 shrink-0 text-caption font-normal text-muted-foreground">Font</span>
          <Select value={style.fontFamily} onValueChange={onFontChange}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            {/* Hundreds of rows once the machine's own fonts are in, so the
                list scrolls rather than growing to the height of the window. */}
            <SelectContent className="max-h-72">
              {fonts.map((font) => (
                // Each row set in the font it offers: the names alone say
                // nothing about what the caption will look like.
                <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.stack }}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
