import {
  CAPTION_STYLE_LIMITS,
  captionLengthFor,
  DEFAULT_LINE_RATIO,
  formatTimecode
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
   * Position, size and rotation dragged on the picture. Goes to whichever
   * scope the style panel has selected — this component does not know which.
   *
   * `continuing` marks every frame of a drag after the first, so one gesture
   * lands as one entry in the undo history rather than a hundred.
   */
  onCaptionStyleChange(patch: Partial<CaptionStyle>, options?: { continuing?: boolean }): void
  /** CSS font-family for the caption; resolved by the caller. */
  captionFontStack: string
  /** Everything else about the caption's appearance, already resolved. */
  captionStyle: CaptionStyle
}

/**
 * The video sits centred in whatever space the pane gives it, letterboxed by
 * the panel surface on the short axis.
 *
 * The native `controls` bar is deliberately absent. It belongs to the file in
 * the element, and the element only ever holds one clip of a timeline that may
 * be made of several — its scrubber would measure the wrong thing, and its
 * clock would restart at every cut. Position is the timeline's job, so the bar
 * here carries only what a monitor needs: where playback is against the whole
 * timeline, a transport toggle, and fullscreen. Scrubbing lives on the
 * timeline, which is why there is no progress bar.
 *
 * Captions have no toggle: they show whenever the active asset has a
 * transcript, and there is nothing to show when it does not. A switch would
 * only ever be turned off to see a frame unobstructed, which the caption's
 * placement already allows.
 */
/**
 * Where the caption block sits when it is narrower than the picture.
 *
 * `text-align` alone only moves the text inside the block; with a background
 * behind it, the block itself has to move too or "align left" leaves a centred
 * box with left-aligned text in it.
 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const clampSize = (value: number): number =>
  Math.min(
    CAPTION_STYLE_LIMITS.fontSizePct.max,
    Math.max(CAPTION_STYLE_LIMITS.fontSizePct.min, Math.round(value * 10) / 10)
  )

/** Distance from the block's top edge up to the rotation handle. */
const ROTATE_STALK = 24

const CORNERS = [
  { name: 'top left', x: '0%', y: '0%', cursor: 'cursor-nwse-resize' },
  { name: 'top right', x: '100%', y: '0%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom left', x: '0%', y: '100%', cursor: 'cursor-nesw-resize' },
  { name: 'bottom right', x: '100%', y: '100%', cursor: 'cursor-nwse-resize' }
] as const

/** A gesture in progress, and what it started from. */
interface Drag {
  mode: 'move' | 'scale' | 'rotate'
  pointerId: number
  /** The block's centre in client coordinates — the origin for both scale and
   *  rotate, and what makes them immune to the block's own rotation. */
  centre: { x: number; y: number }
  /** Pointer at the start, for the move delta. */
  from: { x: number; y: number }
  /** Distance and angle to the pointer at the start, for scale and rotate. */
  radius: number
  angle: number
  /** False until the first frame that actually writes, which is the one the
   *  history records. A press that never moves records nothing. */
  moved: boolean
  style: { x: number; y: number; rotation: number; fontSizePct: number }
}

/** Angle from a centre to a point, in degrees, clockwise from 12 o'clock. */
function angleAt(centre: { x: number; y: number }, x: number, y: number): number {
  return (Math.atan2(y - centre.y, x - centre.x) * 180) / Math.PI + 90
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
  /**
   * The line being typed into, or null. Holding the text here rather than
   * writing through on every keystroke is what lets Escape put the original
   * back, and keeps one edit to one undo entry.
   */
  const [editing, setEditing] = useState<{ text: string } | null>(null)
  /** Selection is the player's own state, not the document's: it is where the
   *  pointer is, and it should not survive a reload or reach the file. */
  const [selected, setSelected] = useState(false)
  const dragRef = useRef<Drag | null>(null)

  /** The caption's size in this pane's pixels. Every other length below is
   *  derived from it or scaled the same way, so it is computed once. */
  const fontSizePx = (frame.height * captionStyle.fontSizePct) / 100

  /** Shared by the caption and the box that replaces it, so editing does not
   *  reflow the very text being edited. */
  const captionCss = {
    fontFamily: captionFontStack,
    fontSize: fontSizePx,
    fontWeight: captionStyle.bold ? 700 : 400,
    fontStyle: captionStyle.italic ? 'italic' : 'normal',
    textDecoration: captionStyle.underline ? 'underline' : 'none',
    color: captionStyle.color,
    // Both spacings are stored against the reference frame, so they scale with
    // the picture exactly as the size does — otherwise tightening the letters
    // in the preview would leave them untouched at export.
    letterSpacing: captionLengthFor(captionStyle.letterSpacing, frame.height),
    lineHeight: `${fontSizePx * DEFAULT_LINE_RATIO + captionLengthFor(captionStyle.lineSpacing, frame.height)}px`,
    textAlign: captionStyle.align
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
      moved: false,
      style: {
        x: captionStyle.x,
        y: captionStyle.y,
        rotation: captionStyle.rotation,
        fontSizePct: captionStyle.fontSizePct
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onDragMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || frame.width === 0) return

    const options = { continuing: drag.moved }
    drag.moved = true

    if (drag.mode === 'move') {
      // The picture's own size is the unit: dragging a third of the way across
      // moves the caption a third of the way, whatever the pane's zoom.
      onCaptionStyleChange(
        {
          x: clamp01(drag.style.x + (event.clientX - drag.from.x) / frame.width),
          y: clamp01(drag.style.y + (event.clientY - drag.from.y) / frame.height)
        },
        options
      )
      return
    }

    if (drag.mode === 'scale') {
      if (drag.radius === 0) return
      const ratio =
        Math.hypot(event.clientX - drag.centre.x, event.clientY - drag.centre.y) / drag.radius
      onCaptionStyleChange({ fontSizePct: clampSize(drag.style.fontSizePct * ratio) }, options)
      return
    }

    const turned = angleAt(drag.centre, event.clientX, event.clientY) - drag.angle
    // Wrapped into (-180, 180] so dragging past the top does not jump by a
    // full turn, and so the stored value stays in the range the core allows.
    const rotation = (((drag.style.rotation + turned + 180) % 360) + 360) % 360
    onCaptionStyleChange({ rotation: Math.round(rotation) - 180 }, options)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
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
    setEditing({ text: captionText })
  }

  const commitEditing = (): void => {
    if (editing === null) return
    const next = editing.text.trim()
    setEditing(null)
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
    setEditing(null)
  }, [captionText])

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
              {/* Positioned by its centre, then rotated about it. Storing the
                  centre rather than a corner is what keeps rotation and scaling
                  from also moving the caption: both are about this point.

                  `align` no longer places the block — it went back to meaning
                  what it says, the alignment of the text within it, now that
                  the position is a coordinate. */}
              <div
                data-caption-block
                className="absolute"
                style={{
                  left: `${captionStyle.x * 100}%`,
                  top: `${captionStyle.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${captionStyle.rotation}deg)`,
                  maxWidth: frame.width
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
                  reason it is not stored in pixels. */}
                {editing === null ? (
                  <span
                    // Only the caption takes the pointer; the rest of the overlay
                    // stays transparent to it so the picture below is unaffected.
                    className={`pointer-events-auto block max-w-full rounded-panel bg-black/60 px-stack py-inline [text-wrap:balance] ${
                      selected ? 'cursor-move' : 'cursor-pointer'
                    }`}
                    style={captionCss}
                    title={selected ? 'Drag to move · double-click to edit' : 'Click to select'}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      setSelected(true)
                      // Only a drag that starts on the block itself moves it; the
                      // handles are siblings and start their own gestures.
                      if (selected) beginDrag(event, 'move')
                    }}
                    onDoubleClick={beginEditing}
                  >
                    {captionText}
                  </span>
                ) : (
                  /* Same box, same type: what is being typed has to look like
                   what it will be, or the line is edited against one set of
                   metrics and read back in another.
                   `field-sizing:content` keeps the box the size of the text,
                   so a caption does not jump as the first character lands. */
                  <textarea
                    autoFocus
                    value={editing.text}
                    className="pointer-events-auto max-w-full resize-none rounded-panel border border-primary bg-black/60 px-stack py-inline outline-none [field-sizing:content]"
                    style={captionCss}
                    onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                    onBlur={commitEditing}
                    onKeyDown={(event) => {
                      // Enter commits, Shift+Enter breaks the line: a caption is
                      // usually one line, and reaching for a button to save one
                      // would cost more than the edit.
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        commitEditing()
                      }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                )}

                {/* Handles only while selected and not typing: during an edit the
                  block is a text field, and a grab handle over it would fight
                  the caret for the same pointer. */}
                {selected && editing === null && (
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
                        aria-label={`Resize from ${corner.name}`}
                        aria-valuenow={Math.round(captionStyle.fontSizePct * 10) / 10}
                        tabIndex={-1}
                        className={`pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-background ${corner.cursor}`}
                        style={{ left: corner.x, top: corner.y }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          beginDrag(event, 'scale')
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
                      aria-valuenow={Math.round(captionStyle.rotation)}
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
