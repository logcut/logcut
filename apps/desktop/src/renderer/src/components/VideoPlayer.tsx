import {
  CAPTION_STYLE_LIMITS,
  captionFontSizePct,
  captionLengthFor,
  captionWrapShare,
  DEFAULT_LINE_RATIO,
  formatTimecode,
  SNAP_TOLERANCE_PX,
  snapToNearest
} from '@logcut/core'
import type { CaptionStyle } from '@logcut/core'
import { Maximize, Minimize, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { Button } from '@/components/ui/button'

interface VideoPlayerProps {
  /** The element is the timeline's playback engine, so its owner holds the ref. */
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  /** Where the loaded clip starts on the timeline; element time is relative. */
  clipOffsetMs: number
  /** Length of the whole timeline — what the readout counts towards. */
  durationMs: number
  onTimeUpdate(currentTimeMs: number): void
  /** The loaded file ran out. The timeline uses this to roll onto the next clip. */
  onEnded(): void
  /** Text of the utterance playing now; null or empty renders no caption. */
  captionText: string | null
  /** Commit an edit made on the picture. The caller knows which line is
   *  showing; this component only knows what it says. */
  onCaptionEdit(text: string): void
  /**
   * Position, size and rotation dragged on the picture. Goes to whichever scope
   * the style panel has selected — this component does not know which.
   *
   * Called **once per gesture, on release**, never per frame: the caption
   * follows the pointer from local state and the document hears the result. One
   * call is also one undo entry.
   */
  onCaptionStyleChange(patch: Partial<CaptionStyle>): void
  /** CSS font-family for the caption; resolved by the caller. */
  captionFontStack: string
  /**
   * Whether a dragged caption lands on the centre of the picture. The same
   * switch the timeline obeys, and off is a real working mode for the same
   * reason: a caption meant to sit just off centre cannot be nudged there
   * while every drag keeps pulling it back.
   */
  snapEnabled: boolean
  /** Everything else about the caption's appearance, already resolved. */
  captionStyle: CaptionStyle
}

/**
 * The video sits centred in whatever space the pane gives it, letterboxed by
 * the panel surface on the short axis.
 *
 * **No native `controls`, and no caption toggle** — the reasons for both are
 * in VideoPlayer.md. What matters here: the element holds one clip of a
 * timeline that may have several, so its clock is not the timeline's, and
 * position is reported against the timeline instead.
 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const clampScale = (value: number): number =>
  Math.min(
    CAPTION_STYLE_LIMITS.scalePct.max,
    Math.max(CAPTION_STYLE_LIMITS.scalePct.min, Math.round(value))
  )
const clampWidth = (value: number): number =>
  Math.min(
    CAPTION_STYLE_LIMITS.widthPct.max,
    // Never 0 from a drag: that is auto, and a gesture that landed on it would
    // hand the box back to the text mid-drag.
    Math.max(1, Math.round(value * 10) / 10)
  )

/** Distance from the block's top edge up to the rotation handle. */
const ROTATE_STALK = 24

/** The one landmark a dragged caption lands on, per axis. Centred is the only
 *  position with a name — everything else is wherever it was put. */
const CENTRE = 0.5

const CORNERS = [
  { name: 'top left', x: '0%', y: '0%', cursor: 'cursor-nwse-resize' },
  { name: 'top right', x: '100%', y: '0%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom left', x: '0%', y: '100%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom right', x: '100%', y: '100%', cursor: 'cursor-nwse-resize' }
] as const

/** Only the two sides. A caption's height is its text's height — there is
 *  nothing for a top or bottom handle to drag. */
const SIDES = [
  { name: 'left', x: '0%' },
  { name: 'right', x: '100%' }
] as const

/** A gesture in progress, and what it started from. */
interface Drag {
  mode: 'move' | 'scale' | 'rotate' | 'width'
  pointerId: number
  /** The block's centre in client coordinates — the origin for both scale and
   *  rotate, and what makes them immune to the block's own rotation. */
  centre: { x: number; y: number }
  /** Pointer at the start, for the move delta. */
  from: { x: number; y: number }
  /** Distance and angle to the pointer at the start, for scale and rotate. */
  radius: number
  angle: number
  style: Pick<CaptionStyle, 'x' | 'y' | 'rotation' | 'scalePct'>
}

/** Angle from a centre to a point, in degrees, clockwise from 12 o'clock. */
function angleAt(centre: { x: number; y: number }, x: number, y: number): number {
  return (Math.atan2(y - centre.y, x - centre.x) * 180) / Math.PI + 90
}

/** `#rrggbb` and a percentage, as the eight-digit hex CSS takes. */
function withAlpha(hex: string, opacityPct: number): string {
  const alpha = Math.round(clamp01(opacityPct / 100) * 255)
  return `${hex}${alpha.toString(16).padStart(2, '0')}`
}

export default function VideoPlayer({
  videoRef,
  src,
  clipOffsetMs,
  durationMs,
  onTimeUpdate,
  onEnded,
  captionText,
  onCaptionEdit,
  onCaptionStyleChange,
  captionFontStack,
  captionStyle,
  snapEnabled
}: VideoPlayerProps): JSX.Element {
  /** Fullscreen takes the controls with the picture, so it is the whole pane. */
  const paneRef = useRef<HTMLDivElement>(null)
  const [elementMs, setElementMs] = useState(0)
  const [paused, setPaused] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  /** The picture's size on screen — the letterbox around it is not it. */
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  /**
   * Whether the caption is being typed into. The text itself stays in the DOM
   * rather than in state — see the caption element below.
   */
  const [editing, setEditing] = useState(false)
  /** The caption element: an edit is focused through it and read back off it. */
  const captionRef = useRef<HTMLDivElement>(null)
  /** Selection is the player's own state, not the document's: it is where the
   *  pointer is, and it should not survive a reload or reach the file. */
  const [selected, setSelected] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  /**
   * What the gesture has changed so far, not yet committed.
   *
   * Writing to the document per frame re-rendered everything the editor shows —
   * the subtitle list and the whole style panel — to move one block; a
   * four-second drag spent ~660ms in React on a packaged build.
   *
   * **Held twice over**: the ref is what the release reads, because state set
   * during a gesture is not visible to the handler that ends it; the state is
   * what makes the caption follow the pointer.
   */
  const pendingRef = useRef<Partial<CaptionStyle> | null>(null)
  const [pending, setPending] = useState<Partial<CaptionStyle> | null>(null)

  /** What to draw: the document, with an unfinished gesture laid over it. */
  const style = pending === null ? captionStyle : { ...captionStyle, ...pending }

  /** The caption's size in this pane's pixels. Every other length below is
   *  derived from it or scaled the same way, so it is computed once. */
  const fontSizePx = (frame.height * captionFontSizePct(style)) / 100

  /** Where the text wraps, in this pane's pixels — the same limit the burn-in
   *  takes from the event's margins. */
  const wrapPx = frame.width * captionWrapShare(style.widthPct)

  /**
   * A guide is drawn per axis that is centred, while the caption is being
   * moved. Read off the pending patch rather than held in state of its own:
   * `x` is only ever in there during a move, so its presence *is* "a move is
   * under way" and there is nothing to keep in step.
   */
  const moving = pending?.x !== undefined
  const guides = {
    vertical: moving && style.x === CENTRE,
    horizontal: moving && style.y === CENTRE
  }

  /** Everything about the caption's type that comes from the document. */
  const captionCss = {
    fontFamily: captionFontStack,
    fontSize: fontSizePx,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    color: style.color,
    // Both spacings are stored against the reference frame, so they scale with
    // the picture exactly as the size does — otherwise tightening the letters
    // in the preview would leave them untouched at export.
    letterSpacing: captionLengthFor(style.letterSpacing, frame.height),
    lineHeight: `${fontSizePx * DEFAULT_LINE_RATIO + captionLengthFor(style.lineSpacing, frame.height)}px`,
    textAlign: style.align,
    // **Doubled, and painted under the fill.** A CSS text stroke straddles the
    // glyph's edge, so half of it is spent eating into the letterform; ASS's
    // `\bord` grows outward only. Twice the width with the fill on top leaves
    // exactly the outward half showing, which is the width that was asked for.
    WebkitTextStrokeWidth: style.outline
      ? captionLengthFor(style.outlineWidth, frame.height) * 2
      : 0,
    WebkitTextStrokeColor: withAlpha(style.outlineColor, style.outlineOpacityPct),
    paintOrder: 'stroke fill'
  } as const

  /**
   * Start a move, a scale or a rotation.
   *
   * Every gesture is measured against the block's **centre**, taken once at
   * the start. That is what lets scaling and rotation ignore the rotation
   * already applied: a distance and an angle from a fixed point mean the same
   * thing however the block beneath is turned, so none of this needs the
   * inverse transform.
   */
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, mode: Drag['mode']): void => {
    const block = event.currentTarget.closest('[data-caption-block]')
    if (!block) return
    const box = block.getBoundingClientRect()
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const dx = event.clientX - centre.x
    const dy = event.clientY - centre.y
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      centre,
      from: { x: event.clientX, y: event.clientY },
      radius: Math.hypot(dx, dy),
      angle: angleAt(centre, event.clientX, event.clientY),
      // Read through `style`, so a gesture begun before the previous one has
      // been written back still starts from what is on screen.
      style: { x: style.x, y: style.y, rotation: style.rotation, scalePct: style.scalePct }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /** Keep a frame's result on screen without telling the document about it. */
  const preview = (patch: Partial<CaptionStyle>): void => {
    pendingRef.current = { ...pendingRef.current, ...patch }
    setPending(pendingRef.current)
  }

  const onDragMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || frame.width === 0) return

    if (drag.mode === 'move') {
      // The picture's own size is the unit: dragging a third of the way across
      // moves the caption a third of the way, whatever the pane's zoom.
      //
      // The tolerance is a distance the hand can hold, so it is stated on
      // screen and divided by the picture to reach the share this is measured
      // in — the same conversion the timeline does with its scale. Snapping
      // off makes it zero, which `snapToNearest` reads as "do not".
      const tolerance = snapEnabled ? SNAP_TOLERANCE_PX : 0
      preview({
        x: snapToNearest(
          clamp01(drag.style.x + (event.clientX - drag.from.x) / frame.width),
          [CENTRE],
          tolerance / frame.width
        ),
        y: snapToNearest(
          clamp01(drag.style.y + (event.clientY - drag.from.y) / frame.height),
          [CENTRE],
          tolerance / frame.height
        )
      })
      return
    }

    if (drag.mode === 'scale') {
      if (drag.radius === 0) return
      const ratio =
        Math.hypot(event.clientX - drag.centre.x, event.clientY - drag.centre.y) / drag.radius
      preview({ scalePct: clampScale(drag.style.scalePct * ratio) })
      return
    }

    if (drag.mode === 'width') {
      // The one gesture that is about a direction rather than a distance, so
      // it is the one that has to undo the block's rotation: the pointer's
      // offset is projected onto the block's own horizontal axis. Taking the
      // raw distance instead would widen the box when the pointer moved
      // *along* a turned edge.
      const radians = (drag.style.rotation * Math.PI) / 180
      const along =
        (event.clientX - drag.centre.x) * Math.cos(radians) +
        (event.clientY - drag.centre.y) * Math.sin(radians)
      // The box is positioned by its centre, so a side handle is half a width
      // away from it and both sides grow together.
      preview({ widthPct: clampWidth((Math.abs(along) * 2 * 100) / frame.width) })
      return
    }

    const turned = angleAt(drag.centre, event.clientX, event.clientY) - drag.angle
    // Wrapped into (-180, 180] so dragging past the top does not jump by a
    // full turn, and so the stored value stays in the range the core allows.
    const rotation = (((drag.style.rotation + turned + 180) % 360) + 360) % 360
    preview({ rotation: Math.round(rotation) - 180 })
  }

  /**
   * The gesture is over: hand the result to the document, once.
   *
   * The overlay drops in the same breath without flashing back to the old value
   * — the page applies the change to its own state before it goes to disk.
   *
   * A press that never moved leaves `pendingRef` null and commits nothing, which
   * is what keeps a click that only selects out of the undo history.
   */
  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    const patch = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (patch) onCaptionStyleChange(patch)
  }

  /**
   * Editing pins to the line that is on screen right now, so playback has to
   * stop: a running video would move the caption on to the next line while the
   * box still held the previous one's text, and the edit would land on whatever
   * happened to be showing when it was committed.
   */
  const beginEditing = (): void => {
    if (captionText === null) return
    videoRef.current?.pause()
    // The caption element is rebuilt for the edit, which takes with it the
    // pointer capture the double-click's first press may have started a move
    // on. Drop that gesture too, or the half-pixel it travelled stays laid
    // over the document until some later press happens to end it.
    dragRef.current = null
    pendingRef.current = null
    setPending(null)
    setEditing(true)
  }

  const commitEditing = (): void => {
    if (!editing) return
    // `innerText`, not `textContent`: a line break the browser chose to store
    // as an element reads back as the newline it looks like.
    const next = (captionRef.current?.innerText ?? '').trim()
    setEditing(false)
    // An unchanged line is reported as unchanged by the command layer anyway;
    // stopping here also spares the round trip.
    if (next !== '' && next !== captionText) onCaptionEdit(next)
  }

  // Escape drops the selection wherever the pointer is — the keyboard's own
  // way off an object, and the only way out when the caption fills the picture.
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  // A clip change or a seek can replace the line under an open editor. Rather
  // than write the text onto whatever line arrived, the edit is dropped — the
  // caption it was opened on is no longer the caption on screen.
  useEffect(() => {
    setEditing(false)
  }, [captionText])

  // The edit starts on a freshly built element, so the caret can only be
  // placed once that element is mounted.
  useEffect(() => {
    if (!editing) return
    const element = captionRef.current
    if (!element) return
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [editing])

  // Escape and the platform's own shortcut leave fullscreen without touching
  // the button, so the icon follows the document rather than the last click.
  useEffect(() => {
    const sync = (): void => setFullscreen(document.fullscreenElement === paneRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // The caption belongs to the picture, so it has to be laid out against the
  // picture's box rather than the pane's — otherwise a frame that does not fill
  // the pane leaves the caption stranded in the letterbox beside it.
  //
  // Measuring beats deriving the box from the aspect ratio: a replaced element
  // bounded on both axes already sizes itself to the picture exactly, and CSS
  // has no way to hand that result to a sibling. It moves whenever the pane
  // resizes or a clip of another shape loads, both of which the observer sees.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box) setFrame({ width: box.width, height: box.height })
    })
    observer.observe(video)
    return () => observer.disconnect()
  }, [videoRef])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void paneRef.current?.requestFullscreen()
  }

  return (
    // Letterboxing is the panel surface showing through, so a frame that does
    // not fill the pane reads as one continuous panel rather than a black box
    // sitting in it. Fullscreen is the exception: there the surround has to be
    // black, because nothing else is on screen to judge the picture against.
    <div
      ref={paneRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card [&:fullscreen]:bg-black"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <video
          ref={videoRef}
          className="max-h-full max-w-full"
          src={src}
          onTimeUpdate={(event) => {
            const ms = event.currentTarget.currentTime * 1000
            setElementMs(ms)
            onTimeUpdate(ms)
          }}
          // A seek lands the readout even when nothing is playing, and a clip
          // swap parks its position until the new file reports metadata.
          onSeeked={(event) => setElementMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) => setElementMs(event.currentTarget.currentTime * 1000)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={onEnded}
        />
        {captionText && frame.width > 0 && (
          <div
            // Transparent to the pointer until something is selected, so the
            // picture is untouched in the ordinary case. While a caption is
            // selected it becomes the surface that a click "off the object"
            // lands on — the caption and its handles stop propagation, so
            // anything reaching here is a click on the picture itself.
            className={`absolute inset-0 flex items-center justify-center ${
              selected ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            onPointerDown={() => setSelected(false)}
          >
            {/* Sized to the picture, so the caption sits inside the frame
                wherever the letterbox happens to leave it. */}
            <div className="relative" style={{ width: frame.width, height: frame.height }}>
              {/* Before the caption, so a guide passes behind the text rather
                  than through it. Edge to edge, because what it says is "this
                  line is the middle of the picture" — a stub the length of the
                  caption would only say the caption is where it already is. */}
              {guides.vertical && (
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary" />
              )}
              {guides.horizontal && (
                <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-primary" />
              )}

              {/* Positioned by its centre, then rotated about it. Storing the
                  centre rather than a corner is what keeps rotation and scaling
                  from also moving the caption: both are about this point.

                  `align` no longer places the block — it went back to meaning
                  what it says, the alignment of the text within it, now that
                  the position is a coordinate. */}
              <div
                data-caption-block
                // The plate is centred in the box whatever `align` says, because
                // that is what the burn-in does: an `\an5` event is centred on
                // its `\pos` and the margins that set the wrap width are
                // symmetric. `align` aligns the lines *inside* the plate, which
                // is all it has ever meant here.
                //
                // Flex and not `text-align`, so the box takes its height from
                // the plate exactly — an inline-block would add the line box's
                // descender under it and the selection frame would sit low.
                className="absolute flex justify-center"
                style={{
                  left: `${style.x * 100}%`,
                  top: `${style.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${style.rotation}deg)`,
                  // Under auto, `width: auto` would shrink-to-fit against the
                  // space from `left` to the picture's right edge — half of it
                  // at the default position — and the transform that centres
                  // the block runs after layout, so it hands none of that back.
                  // Stating the width is what puts `maxWidth` in charge of
                  // where a caption wraps.
                  width: style.widthPct === 0 ? 'max-content' : wrapPx,
                  maxWidth: wrapPx
                }}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* The one element styled entirely from data rather than from
                  the application's own scale: this is the user's type choice,
                  and what it has to match is the exported picture.

                  The size is a percentage of the *picture*, so the preview
                  shows the same proportion the export will — that is the whole
                  reason it is not stored in pixels.

                  Showing and editing are one element on purpose: a `<textarea>`
                  cannot be made to break lines where this one does — see
                  VideoPlayer.md. */}
                <div
                  // Rebuilt whenever the mode flips. That is what puts the
                  // original text back on Escape: the browser owns this node's
                  // text during an edit, and React will not rewrite children it
                  // believes it already wrote.
                  key={editing ? 'editing' : 'showing'}
                  ref={captionRef}
                  contentEditable={editing ? 'plaintext-only' : false}
                  suppressContentEditableWarning
                  // Only the caption takes the pointer; the rest of the overlay
                  // stays transparent to it so the picture below is unaffected.
                  //
                  // An outline and not a border for the edit state: a border
                  // would take a pixel out of the text's width on every side
                  // and move the wrap the moment the box was double-clicked.
                  className={`pointer-events-auto max-w-full rounded-panel bg-black/60 px-stack py-inline text-balance whitespace-pre-wrap ${
                    editing
                      ? 'outline-1 -outline-offset-1 outline-primary'
                      : selected
                        ? 'cursor-move'
                        : 'cursor-pointer'
                  }`}
                  style={captionCss}
                  title={
                    editing
                      ? undefined
                      : selected
                        ? 'Drag to move · double-click to edit'
                        : 'Click to select'
                  }
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    // While typing, a press is the caret being placed.
                    if (editing) return
                    setSelected(true)
                    // Only a drag that starts on the block itself moves it; the
                    // handles are siblings and start their own gestures.
                    if (selected) beginDrag(event, 'move')
                  }}
                  onDoubleClick={beginEditing}
                  onBlur={commitEditing}
                  onKeyDown={(event) => {
                    // An IME takes Enter to accept a candidate. Reading that as
                    // the commit ends the edit in the middle of a word.
                    if (event.nativeEvent.isComposing) return
                    // Enter commits, Shift+Enter breaks the line: a caption is
                    // usually one line, and reaching for a button to save one
                    // would cost more than the edit.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      commitEditing()
                    }
                    if (event.key === 'Escape') setEditing(false)
                  }}
                >
                  {captionText}
                </div>

                {/* Handles only while selected and not typing: during an edit
                  the caption takes the caret, and a grab handle over it would
                  fight for the same pointer. */}
                {selected && !editing && (
                  <>
                    {/* A square frame of its own rather than an outline on the
                        caption: an outline follows the block's rounded corners,
                        while the handles are placed at the corners of the box —
                        so they ended up floating outside the curve, reading as
                        four scattered dots rather than as the corners of a
                        frame. The caption keeps its own rounding; this is the
                        selection, not the subtitle. */}
                    <span className="pointer-events-none absolute inset-0 border border-primary" />

                    {CORNERS.map((corner) => (
                      <span
                        key={corner.name}
                        role="slider"
                        aria-label={`Scale from ${corner.name}`}
                        aria-valuenow={Math.round(style.scalePct)}
                        tabIndex={-1}
                        className={`pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-background ${corner.cursor}`}
                        style={{ left: corner.x, top: corner.y }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          beginDrag(event, 'scale')
                        }}
                      />
                    ))}

                    {/* A bar rather than a dot, and only on the two sides: the
                        shape says which axis it moves, and there is no vertical
                        one to confuse it with. */}
                    {SIDES.map((side) => (
                      <span
                        key={side.name}
                        role="slider"
                        aria-label={`Set the caption width from the ${side.name}`}
                        aria-valuenow={Math.round(wrapPx)}
                        tabIndex={-1}
                        className="pointer-events-auto absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-primary bg-background"
                        style={{ left: side.x }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          beginDrag(event, 'width')
                        }}
                      />
                    ))}

                    {/* Above the block, on a stalk, so it is never mistaken for a
                      corner and stays reachable when the block is short. */}
                    <span
                      className="pointer-events-none absolute left-1/2 h-block w-px -translate-x-1/2 bg-primary"
                      style={{ top: `-${ROTATE_STALK}px` }}
                    />
                    <span
                      role="slider"
                      aria-label="Rotate"
                      aria-valuenow={Math.round(style.rotation)}
                      tabIndex={-1}
                      className="pointer-events-auto absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-primary bg-background"
                      style={{ top: `-${ROTATE_STALK}px` }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        beginDrag(event, 'rotate')
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Three tracks rather than a flex row: the transport reads as centred
          under the picture, and stays there however long the timecode gets. */}
      <div className="grid shrink-0 grid-cols-3 items-center px-component py-inline">
        <span className="timecode justify-self-start text-muted-foreground">
          <span className="text-foreground">{formatTimecode(clipOffsetMs + elementMs)}</span>
          {' / '}
          {formatTimecode(durationMs)}
        </span>
        <Button
          variant="ghost"
          size="icon-lg"
          className="justify-self-center"
          title={paused ? 'Play' : 'Pause'}
          onClick={togglePlay}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="justify-self-end"
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
        </Button>
      </div>
    </div>
  )
}
