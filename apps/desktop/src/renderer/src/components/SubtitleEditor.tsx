import {
  CAPTION_REFERENCE_HEIGHT,
  CAPTION_STYLE_LIMITS,
  captionSizePct,
  captionSizePx
} from '@logcut/core'
import type { CaptionAlign, CaptionStyle, Utterance } from '@logcut/core'
import type { CaptionScope } from '@/lib/caption-scope'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Search,
  Underline,
  Undo2,
  X
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
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
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCaptionFonts } from '@/hooks/useCaptionFonts'

/**
 * Every length in this panel is quoted against the same reference frame, so a
 * number means the same thing whichever row it is in — and so that none of them
 * changes as the preview pane is resized.
 */
const REFERENCE_HINT = `Pixels at ${CAPTION_REFERENCE_HEIGHT}p. Stored relative to the picture, so it holds at any export size.`

/**
 * One setting per row: a fixed-width name, then the control taking the rest.
 *
 * **Every row is the same height**, whatever is in it. A slider is 16px of
 * thumb, a bordered toggle is 22px, a select is 22px plus its border — left to
 * their natural heights the rows come out three different sizes and the gaps
 * between them read as uneven, which is what makes a column of unrelated
 * controls look broken rather than merely varied. The name column lining up is
 * the other half of it.
 */
function StyleRow({
  label,
  readout,
  wide,
  children
}: {
  label: string
  /** The value beside a slider — text, or a control to type it into. Rows
   *  without one still reserve the space. */
  readout?: ReactNode
  /** Let the controls run into the readout column, for a row that carries two
   *  of its own rather than one control and a number. */
  wide?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex h-control-lg items-center gap-component">
      <span className="w-12 shrink-0 text-caption font-normal text-muted-foreground">{label}</span>
      {children}
      {/* Always rendered, empty when a row has no number to show: three
          columns then line up down the section instead of two. Tabular figures
          and a fixed width keep the row still while the digits change. */}
      {!wide && (
        <span className="w-14 shrink-0 text-right">
          {typeof readout === 'string' ? (
            <span className="timecode text-foreground">{readout}</span>
          ) : (
            readout
          )}
        </span>
      )}
    </div>
  )
}

/**
 * A number typed rather than dragged.
 *
 * The value is held as a string while it is being edited, so a half-typed or
 * momentarily empty box is not coerced into a number the rest of the panel
 * jumps to. It commits on blur or Enter, clamped; anything unparseable puts the
 * box back to the real value, which is the whole of the error handling a
 * numeric field needs.
 */
function NumberField({
  value,
  min,
  max,
  label,
  title,
  onCommit
}: {
  value: number
  min: number
  max: number
  label: string
  title?: string
  onCommit(next: number): void
}): JSX.Element {
  const [typed, setTyped] = useState(String(value))
  useEffect(() => setTyped(String(value)), [value])

  const commit = (): void => {
    const parsed = Number.parseInt(typed, 10)
    if (Number.isNaN(parsed)) {
      setTyped(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setTyped(String(next))
    onCommit(next)
  }

  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={typed}
      aria-label={label}
      title={title}
      className="h-control-md w-full px-inline text-right"
      onChange={(event) => setTyped(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/**
 * The style panel.
 *
 * **Memoized, and that is the point.** It is a stack of Radix controls — a
 * select, two toggle groups, three number fields, a slider — and every one of
 * them is layers of forwardRef and context. On a packaged build they accounted
 * for a third of the React time spent during a drag, purely from being
 * re-rendered alongside everything else.
 *
 * The list above re-renders at pointer rate whenever the playhead moves. None
 * of that concerns these controls, so long as their props hold still — which
 * is what `scopedStyle` and `onChange` being memoized upstream buys (see
 * pages/EditorPage.tsx). A single inline arrow passed in here undoes all of it,
 * silently.
 */
const CaptionStylePanel = memo(function CaptionStylePanel({
  style,
  onChange,
  scope,
  onScopeChange,
  speakerIds,
  hasSelection
}: {
  style: CaptionStyle
  onChange(patch: Partial<CaptionStyle>): void
  scope: CaptionScope
  onScopeChange(scope: CaptionScope): void
  speakerIds: string[]
  hasSelection: boolean
}): JSX.Element {
  const fonts = useCaptionFonts()
  // The scope is a tagged union in the model and a flat string in the control;
  // this is the one place the two meet.
  const scopeValue = scope.kind === 'speaker' ? `speaker:${scope.speakerId}` : scope.kind
  const onScopeSelect = (value: string): void => {
    if (value === 'all' || value === 'line') onScopeChange({ kind: value })
    else onScopeChange({ kind: 'speaker', speakerId: value.slice('speaker:'.length) })
  }

  // The slider's own bounds, in the pixels both it and the box speak.
  const sizeRange = {
    min: captionSizePx(CAPTION_STYLE_LIMITS.fontSizePct.min),
    max: captionSizePx(CAPTION_STYLE_LIMITS.fontSizePct.max)
  }

  return (
    <section className="h-[40%] shrink-0 overflow-y-auto border-b border-border p-component">
      {/* What the controls below write to. It sits in the heading rather than
              in a row of its own because it is not a setting — it is the question
              "which subtitles are we talking about", and every row under it
              inherits the answer.

              The values shown are always the *resolved* ones for that scope, so a
              speaker that overrides nothing still reads as what it will look
              like; changing a control then writes only into the chosen layer. */}
      <div className="mb-component flex items-center gap-component">
        <h2 className="m-0 flex-1 text-caption font-medium text-foreground">Style</h2>
        <Select value={scopeValue} onValueChange={onScopeSelect}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subtitles</SelectItem>
            {/* Only offerable with a line in hand; without one there is
                    nothing for "this line" to mean. */}
            {hasSelection && <SelectItem value="line">This line</SelectItem>}
            {speakerIds.map((speakerId) => (
              <SelectItem key={speakerId} value={`speaker:${speakerId}`}>
                Speaker {speakerId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-component">
        <StyleRow label="Font">
          <Select
            value={style.fontFamily}
            onValueChange={(value) => onChange({ fontFamily: value })}
          >
            <SelectTrigger className="w-full">
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
        </StyleRow>

        {/* Shown and typed in pixels, stored as a share of the picture
                height (see CaptionStyle). The pixels are quoted at a fixed
                1080-high frame, not at the preview's own height — otherwise the
                number would change as the window is dragged, while the caption
                itself did not. */}
        <StyleRow
          label="Size"
          readout={
            <NumberField
              value={captionSizePx(style.fontSizePct)}
              min={sizeRange.min}
              max={sizeRange.max}
              label="Caption size in pixels"
              title={REFERENCE_HINT}
              onCommit={(px) => onChange({ fontSizePct: captionSizePct(px) })}
            />
          }
        >
          <Slider
            value={[captionSizePx(style.fontSizePct)]}
            min={sizeRange.min}
            max={sizeRange.max}
            step={1}
            onValueChange={([next]) => onChange({ fontSizePct: captionSizePct(next) })}
          />
        </StyleRow>

        <StyleRow label="Style">
          <ToggleGroup
            type="multiple"
            variant="outline"
            value={[
              ...(style.bold ? ['bold'] : []),
              ...(style.underline ? ['underline'] : []),
              ...(style.italic ? ['italic'] : [])
            ]}
            onValueChange={(values) =>
              onChange({
                bold: values.includes('bold'),
                underline: values.includes('underline'),
                italic: values.includes('italic')
              })
            }
          >
            <ToggleGroupItem value="bold" aria-label="Bold">
              <Bold />
            </ToggleGroupItem>
            <ToggleGroupItem value="underline" aria-label="Underline">
              <Underline />
            </ToggleGroupItem>
            <ToggleGroupItem value="italic" aria-label="Italic">
              <Italic />
            </ToggleGroupItem>
          </ToggleGroup>
        </StyleRow>

        {/* The platform's own colour picker. Nothing hand-rolled comes close
                to it — eyedropper, recent colours, every model the OS offers —
                and a caption colour is picked against the frame behind it, which
                a swatch grid cannot help with. */}
        <StyleRow label="Colour">
          <label className="flex h-control-md cursor-pointer items-center gap-component rounded-md border border-input px-compact">
            <span
              className="size-icon-sm rounded-sm border border-border"
              style={{ backgroundColor: style.color }}
            />
            <span className="timecode text-foreground uppercase">{style.color}</span>
            <input
              type="color"
              value={style.color}
              className="sr-only"
              onChange={(event) => onChange({ color: event.target.value })}
            />
          </label>
        </StyleRow>

        {/* Both on one row, typed rather than dragged: they are adjustments
                of a few pixels around a default that is already right, and a
                slider spanning the whole useful range cannot resolve one of them.
                Both read 0 at the default — extra spacing, not absolute spacing,
                which is why 0 leading is not what 0 means here. */}
        <StyleRow label="Spacing" wide>
          <div className="flex flex-1 items-center gap-component">
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Letter</span>
            <NumberField
              value={style.letterSpacing}
              min={CAPTION_STYLE_LIMITS.letterSpacing.min}
              max={CAPTION_STYLE_LIMITS.letterSpacing.max}
              label="Extra space between characters"
              title={REFERENCE_HINT}
              onCommit={(next) => onChange({ letterSpacing: next })}
            />
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Line</span>
            <NumberField
              value={style.lineSpacing}
              min={CAPTION_STYLE_LIMITS.lineSpacing.min}
              max={CAPTION_STYLE_LIMITS.lineSpacing.max}
              label="Extra space between lines"
              title={REFERENCE_HINT}
              onCommit={(next) => onChange({ lineSpacing: next })}
            />
          </div>
        </StyleRow>

        {/* Horizontal only. Vertical writing is a typesetting mode rather
                than an alignment — it changes how lines wrap and how the block is
                measured — so it belongs with its own work, not in this row. */}
        <StyleRow label="Align">
          <ToggleGroup
            type="single"
            variant="outline"
            value={style.align}
            // Radix reports '' when the pressed item is pressed again; an
            // alignment always has a value, so that clears nothing.
            onValueChange={(value) => {
              if (value !== '') onChange({ align: value as CaptionAlign })
            }}
          >
            <ToggleGroupItem value="left" aria-label="Align left">
              <AlignLeft />
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Align centre">
              <AlignCenter />
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Align right">
              <AlignRight />
            </ToggleGroupItem>
          </ToggleGroup>
        </StyleRow>
      </div>
    </section>
  )
})

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
  /** Both the speaker dropdown's options and the scopes on offer — one list,
   *  because they are the same speakers. */
  speakerIds: string[]
  nextSpeakerId: string
  onSpeakerSave(id: string, speakerId: string): void
  onUndo(): void
  onReplaceAll(find: string, replace: string): number
  /** The style as it resolves for the scope currently selected. */
  style: CaptionStyle
  /** One field or several; the caller writes them into the selected scope. */
  onChange(patch: Partial<CaptionStyle>): void
  scope: CaptionScope
  onScopeChange(scope: CaptionScope): void
  /** Whether a line is selected, which is what `line` scope needs. */
  hasSelection: boolean
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
  onChange,
  scope,
  onScopeChange,
  hasSelection
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
      <CaptionStylePanel
        style={style}
        onChange={onChange}
        scope={scope}
        onScopeChange={onScopeChange}
        speakerIds={speakerIds}
        hasSelection={hasSelection}
      />

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
