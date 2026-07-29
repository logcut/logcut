import {
  CAPTION_REFERENCE_HEIGHT,
  CAPTION_STYLE_LIMITS,
  captionSizePct,
  captionSizePx,
  DEFAULT_CAPTION_STYLE
} from '@logcut/core'
import type { CaptionAlign, CaptionStyle, Utterance } from '@logcut/core'
import type { CaptionScope } from '@/lib/caption-scope'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  RotateCcw,
  Search,
  Underline,
  Undo2,
  X
} from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import ResizeHandle from '@/components/ResizeHandle'
import SubtitleList from '@/components/SubtitleList'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCaptionFonts } from '@/hooks/useCaptionFonts'

/**
 * Every length in this panel is quoted against the same reference frame, so a
 * number means the same thing whichever row it is in — and so that none of them
 * changes as the preview pane is resized.
 */
const REFERENCE_HINT = `Pixels at ${CAPTION_REFERENCE_HEIGHT}p. Stored relative to the picture, so it holds at any export size.`

/** What the Layout reset puts back. Read off the default style rather than
 *  written out again, so changing a default cannot leave this button behind. */
const DEFAULT_LAYOUT: Partial<CaptionStyle> = {
  scalePct: DEFAULT_CAPTION_STYLE.scalePct,
  widthPct: DEFAULT_CAPTION_STYLE.widthPct,
  x: DEFAULT_CAPTION_STYLE.x,
  y: DEFAULT_CAPTION_STYLE.y,
  rotation: DEFAULT_CAPTION_STYLE.rotation
}

/** One setting per row: a fixed-width name, the control, a fixed-width readout.
 *  **Every row is the same height whatever is in it** — see SubtitleEditor.md
 *  for why that is not cosmetic. */
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

/** **Held as a string while being edited**, so a half-typed or momentarily empty
 *  box is not coerced into a number the rest of the panel jumps to. Commits on
 *  blur or Enter, clamped; anything unparseable puts the box back. */
function NumberField({
  value,
  min,
  max,
  label,
  title,
  disabled,
  onCommit
}: {
  value: number
  min: number
  max: number
  label: string
  title?: string
  /** For a field whose value is being decided by something else — the width
   *  while it is on auto. */
  disabled?: boolean
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
      disabled={disabled}
      className="h-control-md w-full px-inline text-right"
      onChange={(event) => setTyped(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/** How long a pause has to be before the next colour counts as a new pick.
 *  The picker reports every movement of the cursor inside it and has **no event
 *  for the gesture ending**, so a gap in time is all there is to separate one
 *  drag from the next. */
const COLOUR_GESTURE_GAP_MS = 400

/** A colour, shown as a swatch and its hex. **The platform's own picker, not a
 *  swatch grid of ours** (see SubtitleEditor.md). The real `<input>` is only
 *  visually hidden, so it keeps its keyboard behaviour and its label. */
function ColourField({
  value,
  label,
  disabled,
  onChange
}: {
  value: string
  label: string
  disabled?: boolean
  onChange(next: string, options?: { continuing?: boolean }): void
}): JSX.Element {
  const lastChangeRef = useRef(0)

  return (
    <label
      className={`flex h-control-md items-center gap-component rounded-md border border-input px-compact ${
        disabled === true ? 'pointer-events-none opacity-50' : 'cursor-pointer'
      }`}
    >
      <span
        className="size-icon-sm rounded-sm border border-border"
        style={{ backgroundColor: value }}
      />
      <span className="timecode text-foreground uppercase">{value}</span>
      <input
        type="color"
        value={value}
        aria-label={label}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const now = performance.now()
          const continuing = now - lastChangeRef.current < COLOUR_GESTURE_GAP_MS
          lastChangeRef.current = now
          onChange(event.target.value, { continuing })
        }}
      />
    </label>
  )
}

/** One collapsible group of settings. **Open to begin with, every one of them**
 *  — collapsing is for reaching the list sooner, not for admitting a group is
 *  secondary. The gap below belongs to the content, so closing a group actually
 *  gets it back. */
function StyleGroup({
  title,
  action,
  children
}: {
  title: string
  /** Whatever sits at the right of the heading: a switch for the layers that
   *  have one, a reset for Layout. */
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <Collapsible defaultOpen>
      <div className="mt-stack flex items-center gap-component">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex flex-1 cursor-pointer items-center gap-inline border-0 bg-transparent p-0 text-caption font-medium text-foreground"
          >
            {/* The chevron turns rather than swapping icons, so the open state
                reads as one control moving instead of two icons alternating. */}
            <ChevronDown
              size={14}
              className="text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
            />
            <h2 className="m-0 font-medium">{title}</h2>
          </button>
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="flex flex-col gap-component pt-component">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The switch in a layer's heading rather than a row of its own: it answers "is
 *  there a shadow at all", while the rows below only describe the one there
 *  is. */
function LayerSwitch({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange(on: boolean): void
}): JSX.Element {
  return (
    <Toggle variant="outline" size="sm" aria-label={label} pressed={on} onPressedChange={onChange}>
      {on ? 'On' : 'Off'}
    </Toggle>
  )
}

/** The colour of one layer. Four of the five groups open with this row, and it
 *  is the same row each time. */
function ColourRow({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: string
  disabled?: boolean
  onChange(next: string, options?: { continuing?: boolean }): void
}): JSX.Element {
  return (
    <StyleRow label="Colour">
      <ColourField
        value={value}
        label={`${label} colour`}
        disabled={disabled}
        onChange={onChange}
      />
    </StyleRow>
  )
}

/** **Dragging and typing are not the same event**, which is why the callbacks
 *  are separate: every frame of a drag goes through `onSlide` and folds into
 *  one undo step, while a typed value is a step of its own through `onCommit`
 *  (see SubtitleEditor.md). */
function ValueRow({
  label,
  value,
  limits,
  name,
  title,
  disabled,
  onSlide,
  onSlideEnd,
  onCommit
}: {
  label: string
  value: number
  limits: { min: number; max: number }
  /** What the control announces itself as, which is rarely just the label. */
  name: string
  title?: string
  disabled?: boolean
  onSlide(next: number): void
  onSlideEnd(): void
  onCommit(next: number): void
}): JSX.Element {
  return (
    <StyleRow
      label={label}
      readout={
        <NumberField
          value={Math.round(value)}
          min={limits.min}
          max={limits.max}
          label={name}
          title={title}
          disabled={disabled}
          onCommit={onCommit}
        />
      }
    >
      <Slider
        value={[value]}
        min={limits.min}
        max={limits.max}
        step={1}
        disabled={disabled}
        onValueChange={([next]) => onSlide(next)}
        onValueCommit={onSlideEnd}
      />
    </StyleRow>
  )
}

/** The style panel. **Memoized, and that is the point** — it is a stack of Radix
 *  controls that accounted for a third of the React time spent during a drag,
 *  purely from being re-rendered alongside everything else. A single inline
 *  arrow passed in here undoes it, silently (see pages/EditorPage.tsx). */
const CaptionStylePanel = memo(function CaptionStylePanel({
  style,
  onChange,
  scope,
  onScopeChange,
  speakerIds,
  hasSelection
}: {
  style: CaptionStyle
  onChange(patch: Partial<CaptionStyle>, options?: { continuing?: boolean }): void
  scope: CaptionScope
  onScopeChange(scope: CaptionScope): void
  speakerIds: string[]
  hasSelection: boolean
}): JSX.Element {
  const fonts = useCaptionFonts()

  /** Marks the frames of a drag that must not be recorded (see
   *  SubtitleEditor.md). **A ref, not state**: it is read by the very handler
   *  that sets it, and a re-render in between would be one per frame for
   *  nothing. One flag covers all five sliders — a pointer holds one. */
  const sliding = useRef(false)
  const slide = (patch: Partial<CaptionStyle>): void => {
    onChange(patch, { continuing: sliding.current })
    sliding.current = true
  }
  /** Radix fires this on release, and on the keyboard too. */
  const endSlide = (): void => {
    sliding.current = false
  }
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
    <section className="min-h-0 flex-1 overflow-y-auto border-b border-border p-component">
      {/* What the controls below write to — the question "which subtitles
              are we talking about", which is why it lives in the heading and not
              in a row of its own (see SubtitleEditor.md). Resolution rules are
              with `styleForScope`. */}
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
            onValueChange={([next]) => slide({ fontSizePct: captionSizePct(next) })}
            onValueCommit={endSlide}
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

      {/* Where the caption sits and how big it is — the four fields the handles
          on the picture drag. A heading rather than four more rows above: these
          answer "where is it", while everything above answers "what does it
          look like", and the reset only makes sense over the first. */}
      <StyleGroup
        title="Layout"
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to the default position and size"
            onClick={() => onChange(DEFAULT_LAYOUT)}
          >
            <RotateCcw size={14} />
          </Button>
        }
      >
        {/* What the corner handles drag. Separate from Size because they answer
            different questions — see CaptionStyle. */}
        <ValueRow
          label="Scale"
          value={style.scalePct}
          limits={CAPTION_STYLE_LIMITS.scalePct}
          name="Caption scale, as a percentage"
          title="A percentage of the size set above. Dragging a corner on the picture changes this, not the size."
          onSlide={(next) => slide({ scalePct: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ scalePct: next })}
        />

        {/* Two numbers, so the row gives up its readout column the way Spacing
            does. Shown as percentages of the picture, which is how they are
            stored — pixels would mean nothing without saying at what size. */}
        <StyleRow label="Pos" wide>
          <div className="flex flex-1 items-center gap-component">
            <span className="shrink-0 text-caption font-normal text-muted-foreground">X</span>
            <NumberField
              value={Math.round(style.x * 100)}
              min={CAPTION_STYLE_LIMITS.x.min * 100}
              max={CAPTION_STYLE_LIMITS.x.max * 100}
              label="Caption centre across the picture, as a percentage"
              onCommit={(next) => onChange({ x: next / 100 })}
            />
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Y</span>
            <NumberField
              value={Math.round(style.y * 100)}
              min={CAPTION_STYLE_LIMITS.y.min * 100}
              max={CAPTION_STYLE_LIMITS.y.max * 100}
              label="Caption centre down the picture, as a percentage"
              onCommit={(next) => onChange({ y: next / 100 })}
            />
          </div>
        </StyleRow>

        {/* No slider: 0 is auto rather than the narrowest width, so a track
            running from it would put the widest behaviour at the narrow end.
            The toggle says which of the two states this is, and the box is the
            width when there is one. */}
        <StyleRow label="Width" wide>
          <div className="flex flex-1 items-center gap-component">
            <Toggle
              variant="outline"
              pressed={style.widthPct === 0}
              // Leaving auto adopts the width auto already resolves to, so the
              // caption itself does not move on the way out.
              onPressedChange={(auto) => onChange({ widthPct: auto ? 0 : 100 })}
            >
              Auto
            </Toggle>
            <NumberField
              value={style.widthPct}
              min={1}
              max={CAPTION_STYLE_LIMITS.widthPct.max}
              label="Caption width, as a percentage of the picture"
              title="Where the caption wraps. Drag either side handle on the picture to set it."
              disabled={style.widthPct === 0}
              onCommit={(next) => onChange({ widthPct: next })}
            />
          </div>
        </StyleRow>

        <ValueRow
          label="Rotate"
          value={style.rotation}
          limits={CAPTION_STYLE_LIMITS.rotation}
          name="Caption rotation in degrees"
          onSlide={(next) => slide({ rotation: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ rotation: next })}
        />
      </StyleGroup>

      {/* **No switch on this one, unlike the three below it** — turning the fill
          off is the same act as taking its opacity to nothing. */}
      <StyleGroup title="Fill">
        <ColourRow
          label="Fill"
          value={style.color}
          onChange={(color, options) => onChange({ color }, options)}
        />
        <ValueRow
          label="Opacity"
          value={style.fillOpacityPct}
          limits={CAPTION_STYLE_LIMITS.fillOpacityPct}
          name="Fill opacity, as a percentage"
          onSlide={(next) => slide({ fillOpacityPct: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ fillOpacityPct: next })}
        />
      </StyleGroup>

      {/* Rows are disabled rather than hidden while a layer is off — the values
          are still there, and every group below does the same. */}
      <StyleGroup
        title="Outline"
        action={
          <LayerSwitch
            label="Outline the caption"
            on={style.outline}
            onChange={(outline) => onChange({ outline })}
          />
        }
      >
        <ColourRow
          label="Outline"
          value={style.outlineColor}
          disabled={!style.outline}
          onChange={(outlineColor, options) => onChange({ outlineColor }, options)}
        />
        <ValueRow
          label="Opacity"
          value={style.outlineOpacityPct}
          limits={CAPTION_STYLE_LIMITS.outlineOpacityPct}
          name="Outline opacity, as a percentage"
          disabled={!style.outline}
          onSlide={(next) => slide({ outlineOpacityPct: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ outlineOpacityPct: next })}
        />
        <ValueRow
          label="Width"
          value={style.outlineWidth}
          limits={CAPTION_STYLE_LIMITS.outlineWidth}
          name="Outline width"
          title={REFERENCE_HINT}
          disabled={!style.outline}
          onSlide={(next) => slide({ outlineWidth: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ outlineWidth: next })}
        />
      </StyleGroup>

      {/* A second copy of the letterforms, laid under them and pushed aside. */}
      <StyleGroup
        title="Shadow"
        action={
          <LayerSwitch
            label="Give the caption a shadow"
            on={style.shadow}
            onChange={(shadow) => onChange({ shadow })}
          />
        }
      >
        <ColourRow
          label="Shadow"
          value={style.shadowColor}
          disabled={!style.shadow}
          onChange={(shadowColor, options) => onChange({ shadowColor }, options)}
        />
        <ValueRow
          label="Opacity"
          value={style.shadowOpacityPct}
          limits={CAPTION_STYLE_LIMITS.shadowOpacityPct}
          name="Shadow opacity, as a percentage"
          disabled={!style.shadow}
          onSlide={(next) => slide({ shadowOpacityPct: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ shadowOpacityPct: next })}
        />
        {/* The one blur in the panel, and it is here because the shadow is the
            only layer either renderer can blur on its own — see CaptionStyle. */}
        <ValueRow
          label="Blur"
          value={style.shadowBlur}
          limits={CAPTION_STYLE_LIMITS.shadowBlur}
          name="Shadow blur"
          title={REFERENCE_HINT}
          disabled={!style.shadow}
          onSlide={(next) => slide({ shadowBlur: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ shadowBlur: next })}
        />
        {/* One quantity between them — where the shadow falls — so neither gets
            a track of its own, and the row gives up its readout column. */}
        <StyleRow label="Offset" wide>
          <div className="flex flex-1 items-center gap-component">
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Dist</span>
            <NumberField
              value={style.shadowDistance}
              min={CAPTION_STYLE_LIMITS.shadowDistance.min}
              max={CAPTION_STYLE_LIMITS.shadowDistance.max}
              label="How far the shadow falls"
              title={REFERENCE_HINT}
              disabled={!style.shadow}
              onCommit={(next) => onChange({ shadowDistance: next })}
            />
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Angle</span>
            <NumberField
              value={Math.round(style.shadowAngle)}
              min={CAPTION_STYLE_LIMITS.shadowAngle.min}
              max={CAPTION_STYLE_LIMITS.shadowAngle.max}
              label="Which way the shadow falls, in degrees"
              title="Degrees clockwise from due right, so 45 is down and to the right."
              disabled={!style.shadow}
              onCommit={(next) => onChange({ shadowAngle: next })}
            />
          </div>
        </StyleRow>
      </StyleGroup>

      {/* On by default, because every caption this program has ever burned had
          a plate. */}
      <StyleGroup
        title="Background"
        action={
          <LayerSwitch
            label="Put the caption on a plate"
            on={style.background}
            onChange={(background) => onChange({ background })}
          />
        }
      >
        <ColourRow
          label="Background"
          value={style.backgroundColor}
          disabled={!style.background}
          onChange={(backgroundColor, options) => onChange({ backgroundColor }, options)}
        />
        <ValueRow
          label="Opacity"
          value={style.backgroundOpacityPct}
          limits={CAPTION_STYLE_LIMITS.backgroundOpacityPct}
          name="Background opacity, as a percentage"
          disabled={!style.background}
          onSlide={(next) => slide({ backgroundOpacityPct: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ backgroundOpacityPct: next })}
        />
        {/* Two numbers, because the plate was never square: it stands further
            out at the sides than above and below, which is what stops a caption
            reading as a label stuck to the picture. */}
        <StyleRow label="Padding" wide>
          <div className="flex flex-1 items-center gap-component">
            <span className="shrink-0 text-caption font-normal text-muted-foreground">X</span>
            <NumberField
              value={style.backgroundPadX}
              min={CAPTION_STYLE_LIMITS.backgroundPadX.min}
              max={CAPTION_STYLE_LIMITS.backgroundPadX.max}
              label="How far the plate stands out at the sides"
              title={REFERENCE_HINT}
              disabled={!style.background}
              onCommit={(next) => onChange({ backgroundPadX: next })}
            />
            <span className="shrink-0 text-caption font-normal text-muted-foreground">Y</span>
            <NumberField
              value={style.backgroundPadY}
              min={CAPTION_STYLE_LIMITS.backgroundPadY.min}
              max={CAPTION_STYLE_LIMITS.backgroundPadY.max}
              label="How far the plate stands out above and below"
              title={REFERENCE_HINT}
              disabled={!style.background}
              onCommit={(next) => onChange({ backgroundPadY: next })}
            />
          </div>
        </StyleRow>
        <ValueRow
          label="Radius"
          value={style.backgroundRadius}
          limits={CAPTION_STYLE_LIMITS.backgroundRadius}
          name="Plate corner radius"
          title={`${REFERENCE_HINT} Rounds the corners in the preview only — a burned-in plate has square ones.`}
          disabled={!style.background}
          onSlide={(next) => slide({ backgroundRadius: next })}
          onSlideEnd={endSlide}
          onCommit={(next) => onChange({ backgroundRadius: next })}
        />
      </StyleGroup>
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
  /** One field or several; the caller writes them into the selected scope.
   *  `continuing` marks a frame in the middle of a drag — see the panel. */
  onChange(patch: Partial<CaptionStyle>, options?: { continuing?: boolean }): void
  scope: CaptionScope
  onScopeChange(scope: CaptionScope): void
  /** Whether a line is selected, which is what `line` scope needs. */
  hasSelection: boolean
  /** The style panel's share of the column, the list taking the rest. */
  styleRatio: number
  /** How far the handle moved, and the height it moved within. The bound is
   *  the caller's to apply — every other minimum in this layout is stated
   *  there, and a ratio has no pixels of its own to check against. */
  onStyleResize(delta: number, room: number): void
}

/** Subtitle editing: the toolbar, the style panel, and the list of lines.
 *  **Nothing about it is modal** — see SubtitleEditor.md. */
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
  hasSelection,
  styleRatio,
  onStyleResize
}: SubtitleEditorProps): JSX.Element {
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [message, setMessage] = useState('')

  /** The two rows the split divides. Measured per drag rather than tracked, so
   *  a resized window never leaves a stale height behind. */
  const splitRef = useRef<HTMLDivElement>(null)
  const resizeStyle = (delta: number): void => {
    const room = splitRef.current?.clientHeight ?? 0
    if (room > 0) onStyleResize(delta, room)
  }

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

      {/* Settings above the list, split by a handle — see SubtitleEditor.md. */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        {/* A plain element carries the share, not the panel itself: the panel
            is memoized, and an inline style object handed to it would be a new
            prop on every frame the playhead moves. */}
        <div className="flex min-h-0 flex-col" style={{ flexGrow: styleRatio, flexBasis: 0 }}>
          <CaptionStylePanel
            style={style}
            onChange={onChange}
            scope={scope}
            onScopeChange={onScopeChange}
            speakerIds={speakerIds}
            hasSelection={hasSelection}
          />
        </div>

        <ResizeHandle orientation="horizontal" onResize={resizeStyle} />

        <div className="flex min-h-0 flex-col" style={{ flexGrow: 1 - styleRatio, flexBasis: 0 }}>
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
      </div>
    </div>
  )
}
