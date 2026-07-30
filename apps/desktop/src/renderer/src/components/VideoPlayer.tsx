import {
  CAPTION_STYLE_LIMITS,
  captionFontSizePct,
  captionLengthFor,
  captionShadowOffset,
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
  /** Position, size and rotation changed on the picture. A drag calls it
   *  **once, on release**, never per frame; an arrow key calls it per press and
   *  passes `continuing` while the key is held — see VideoPlayer.md. */
  onCaptionStyleChange(patch: Partial<CaptionStyle>, options?: { continuing?: boolean }): void
  /** CSS font-family for the caption; resolved by the caller. */
  captionFontStack: string
  /** Everything else about the caption's appearance, already resolved. */
  captionStyle: CaptionStyle
}

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

/** The one landmark a dragged caption lands on, per axis. */
const CENTRE = 0.5

/** How far one arrow-key press moves the caption, in pixels at
 *  `CAPTION_REFERENCE_HEIGHT`, and with Shift held. */
const NUDGE_PX = 1
const NUDGE_PX_COARSE = 10

/** Which axis each arrow key moves the caption along, and which way. */
const NUDGES: Record<string, { axis: 'x' | 'y'; by: number }> = {
  ArrowLeft: { axis: 'x', by: -1 },
  ArrowRight: { axis: 'x', by: 1 },
  ArrowUp: { axis: 'y', by: -1 },
  ArrowDown: { axis: 'y', by: 1 }
}

const CORNERS = [
  { name: 'top left', x: '0%', y: '0%', cursor: 'cursor-nwse-resize' },
  { name: 'top right', x: '100%', y: '0%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom left', x: '0%', y: '100%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom right', x: '100%', y: '100%', cursor: 'cursor-nwse-resize' }
] as const

/** Only the two sides — a caption's height is its text's height. */
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
  captionStyle
}: VideoPlayerProps): JSX.Element {
  /** Fullscreen takes the controls with the picture, so it is the whole pane. */
  const paneRef = useRef<HTMLDivElement>(null)
  const [elementMs, setElementMs] = useState(0)
  const [paused, setPaused] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  /** The picture's size on screen — the letterbox around it is not it. */
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  /** Whether the caption is being typed into. The text itself stays in the DOM
   *  rather than in state — see the caption element below. */
  const [editing, setEditing] = useState(false)
  /** The caption element: an edit is focused through it and read back off it. */
  const captionRef = useRef<HTMLDivElement>(null)
  /** Selection is the player's own state, never the document's. */
  const [selected, setSelected] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  /**
   * What the gesture has changed so far, not yet committed (see
   * VideoPlayer.md).
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

  /** Read off the pending patch rather than held in state of its own: `x` only
   *  ever lands there during a move, so its presence *is* "a move is under way"
   *  and there is nothing to keep in step. */
  const moving = pending?.x !== undefined
  const guides = {
    vertical: moving && style.x === CENTRE,
    horizontal: moving && style.y === CENTRE
  }

  const shadowOffset = captionShadowOffset(style, frame.height)

  /** **The caption's only style source — not one design token belongs in here**
   *  (see VideoPlayer.md). Every length is measured against the reference
   *  frame, so the preview scales exactly the way the burn-in will. */
  const captionCss = {
    fontFamily: captionFontStack,
    fontSize: fontSizePx,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    color: withAlpha(style.color, style.fillOpacityPct),
    letterSpacing: captionLengthFor(style.letterSpacing, frame.height),
    lineHeight: `${fontSizePx * DEFAULT_LINE_RATIO + captionLengthFor(style.lineSpacing, frame.height)}px`,
    textAlign: style.align,
    // **Doubled, and painted under the fill.** A CSS text stroke straddles the
    // glyph's edge while ASS's `\bord` grows outward only, so twice the width
    // with the fill on top leaves exactly the half that was asked for.
    WebkitTextStrokeWidth: style.outline
      ? captionLengthFor(style.outlineWidth, frame.height) * 2
      : 0,
    WebkitTextStrokeColor: withAlpha(style.outlineColor, style.outlineOpacityPct),
    paintOrder: 'stroke fill',
    // **No rotation passed in**: this shadow lives inside the block, whose own
    // transform has already turned it. The burn has to add it, `\pos` being in
    // screen space — same function, two callers (see core/caption-style.md).
    textShadow: style.shadow
      ? `${shadowOffset.dx}px ${shadowOffset.dy}px ${captionLengthFor(style.shadowBlur, frame.height)}px ${withAlpha(style.shadowColor, style.shadowOpacityPct)}`
      : 'none',
    backgroundColor: style.background
      ? withAlpha(style.backgroundColor, style.backgroundOpacityPct)
      : 'transparent',
    // **Padding goes with the plate rather than outliving it**: under ASS the
    // padding *is* the plate's border widths, so a block that kept its inset
    // would sit somewhere else on screen than the one that burns.
    padding: style.background
      ? `${captionLengthFor(style.backgroundPadY, frame.height)}px ${captionLengthFor(style.backgroundPadX, frame.height)}px`
      : 0,
    borderRadius: captionLengthFor(style.backgroundRadius, frame.height)
  } as const

  /** Every gesture is measured against the block's **centre**, taken once at
   *  the start — which is what lets scale and rotate ignore the rotation
   *  already applied, with no inverse transform anywhere (see
   *  VideoPlayer.md). */
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
      // The tolerance is a distance the hand can hold, so it is stated on
      // screen and divided by the picture to reach the share this is measured
      // in.
      preview({
        x: snapToNearest(
          clamp01(drag.style.x + (event.clientX - drag.from.x) / frame.width),
          [CENTRE],
          SNAP_TOLERANCE_PX / frame.width
        ),
        y: snapToNearest(
          clamp01(drag.style.y + (event.clientY - drag.from.y) / frame.height),
          [CENTRE],
          SNAP_TOLERANCE_PX / frame.height
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
      // **The one gesture about a direction rather than a distance, so the one
      // that has to undo the block's rotation**: the offset is projected onto
      // the block's own horizontal axis, or dragging *along* a turned edge
      // would widen the box (see VideoPlayer.md).
      const radians = (drag.style.rotation * Math.PI) / 180
      const along =
        (event.clientX - drag.centre.x) * Math.cos(radians) +
        (event.clientY - drag.centre.y) * Math.sin(radians)
      // Positioned by its centre, so a side handle is half a width away from it
      // and both sides grow together.
      preview({ widthPct: clampWidth((Math.abs(along) * 2 * 100) / frame.width) })
      return
    }

    const turned = angleAt(drag.centre, event.clientX, event.clientY) - drag.angle
    // Wrapped into (-180, 180] so dragging past the top does not jump by a
    // full turn, and so the stored value stays in the range the core allows.
    const rotation = (((drag.style.rotation + turned + 180) % 360) + 360) % 360
    preview({ rotation: Math.round(rotation) - 180 })
  }

  /** The gesture is over: hand the result to the document, once. A press that
   *  never moved leaves `pendingRef` null and commits nothing, which keeps a
   *  click that only selects out of the undo history. */
  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    const patch = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (patch) onCaptionStyleChange(patch)
  }

  /** Pausing is required, not a courtesy: editing pins to the line on screen
   *  right now, and a running video would land the edit on whichever line
   *  happened to be showing at commit time. */
  const beginEditing = (): void => {
    if (captionText === null) return
    videoRef.current?.pause()
    // The element is rebuilt for the edit, which breaks the pointer capture the
    // double-click's first press may have started a move on. Drop that gesture
    // too, or the half-pixel it travelled stays laid over the document until
    // some later, unrelated release commits it.
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
    if (next !== '' && next !== captionText) onCaptionEdit(next)
  }

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelected(false)
        return
      }
      // While typing, the arrows belong to the caret.
      if (editing) return
      const nudge = NUDGES[event.key]
      if (!nudge || captionText === null || frame.width === 0) return
      event.preventDefault()
      const px = (event.shiftKey ? NUDGE_PX_COARSE : NUDGE_PX) * nudge.by
      // Stated against the reference height like every other length, so a press
      // moves the same distance in the export whatever the preview's size —
      // then divided by the picture to reach the share x and y are stored as.
      const onScreen = captionLengthFor(px, frame.height)
      onCaptionStyleChange(
        nudge.axis === 'x'
          ? { x: clamp01(style.x + onScreen / frame.width) }
          : { y: clamp01(style.y + onScreen / frame.height) },
        // A held key repeats about thirty times a second, and one press-and-hold
        // is one thing the user did: only the first of them opens an undo step.
        { continuing: event.repeat }
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, editing, captionText, frame, style.x, style.y, onCaptionStyleChange])

  // A seek can replace the line under an open editor; the edit is dropped
  // rather than written onto whichever line arrived (see VideoPlayer.md).
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

  // The caption is laid out against the *picture's* box, not the pane's, or a
  // frame that does not fill the pane strands it in the letterbox. Measured
  // rather than derived from the aspect ratio: a replaced element bounded on
  // both axes already sizes itself exactly, and CSS cannot hand that result to
  // a sibling.
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
    // Letterboxing is the panel surface showing through; fullscreen is the one
    // exception, where the surround has to be black.
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
            // **Transparent to the pointer until something is selected**, then
            // it becomes the surface a click "off the object" lands on. Left
            // permanently `pointer-events-none` this handler never fires at all
            // and clicking outside does nothing (see VideoPlayer.md).
            className={`absolute inset-0 flex items-center justify-center ${
              selected ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            onPointerDown={() => setSelected(false)}
          >
            {/* Sized to the picture, so the caption sits inside the frame
                wherever the letterbox happens to leave it. */}
            <div className="relative" style={{ width: frame.width, height: frame.height }}>
              {/* Before the caption, so a guide passes behind the text rather
                  than through it (see VideoPlayer.md). */}
              {guides.vertical && (
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary" />
              )}
              {guides.horizontal && (
                <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-primary" />
              )}

              {/* Positioned by its centre, then rotated about it — storing a
                  corner instead would let scaling and rotation move the caption
                  (see VideoPlayer.md). */}
              <div
                data-caption-block
                // Flex and not `text-align`, so the box takes its height from
                // the plate exactly — an inline-block adds the line box's
                // descender and the selection frame then sits low.
                className="absolute flex justify-center"
                style={{
                  left: `${style.x * 100}%`,
                  top: `${style.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${style.rotation}deg)`,
                  // **`max-content`, never `auto`.** An absolutely positioned
                  // box shrink-to-fits against "containing block − `left`" —
                  // half the picture at the default position — and the centring
                  // translate runs after layout, so it hands none of that back.
                  // `maxWidth` alone can then never be reached (VideoPlayer.md).
                  width: style.widthPct === 0 ? 'max-content' : wrapPx,
                  maxWidth: wrapPx
                }}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* **Showing and editing are one element**, not two — a
                    `<textarea>` cannot be made to break lines where this does
                    (see VideoPlayer.md). */}
                <div
                  // Rebuilt whenever the mode flips, and that is what puts the
                  // original text back on Escape: the browser owns this node's
                  // text during an edit, and React will not rewrite children it
                  // believes it already wrote.
                  key={editing ? 'editing' : 'showing'}
                  ref={captionRef}
                  contentEditable={editing ? 'plaintext-only' : false}
                  suppressContentEditableWarning
                  // **An outline, never a border**, for the edit state: a border
                  // takes a pixel out of the text's width on every side and
                  // moves the wrap the instant the box is double-clicked.
                  className={`pointer-events-auto max-w-full text-balance whitespace-pre-wrap ${
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
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      commitEditing()
                    }
                    if (event.key === 'Escape') setEditing(false)
                  }}
                >
                  {captionText}
                </div>

                {/* Handles only while selected and not typing — during an edit
                    they would fight the caret for the same pointer. */}
                {selected && !editing && (
                  <>
                    {/* **A square frame of its own, not an outline on the
                        caption**: an outline follows the plate's rounded
                        corners while the handles sit at the box's corners, so
                        they end up floating outside the curve (VideoPlayer.md). */}
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

                    {/* A bar rather than a dot: the shape says which axis it
                        moves. */}
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

                    {/* On a stalk, so it is never mistaken for a corner and
                        stays reachable when the block is short. */}
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

      {/* Three tracks rather than a flex row, so the transport stays centred
          however long the timecode gets. */}
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
