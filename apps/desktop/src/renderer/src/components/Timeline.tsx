import { findNearestUtteranceIndex, formatTimecode } from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject
} from 'react'
import { Film, Type } from 'lucide-react'
import { usePlaybackClock } from '@/hooks/usePlaybackClock'
import { MEDIA_ASSET_DRAG } from '@/lib/drag'
import { mergeBlocks, pickTickInterval, pxPerMs, tickTimes } from '@/lib/timeline'
import { FILMSTRIP_FRAMES } from '../../../shared/media'

/**
 * Fit-to-width makes a short line a fraction of a pixel wide. Blocks are
 * widened to this so every subtitle stays visible and aimable; nothing is
 * being edited on the timeline, so the drift it introduces costs nothing.
 */
/**
 * Below this a block has no room for a word, and a couple of clipped glyphs
 * read as damage rather than as a label.
 */
const MIN_CAPTION_PX = 28

const MIN_BLOCK_PX = 4

/** Mirrors --timeline-media-strip-height; the frame maths needs the number. */
const STRIP_BAND_HEIGHT = 39

/**
 * How far the pointer may wander and still count as a click rather than a
 * drag. A press is ambiguous until it either moves or is released, and the
 * hand slips a pixel or two on the way up.
 */
const CLICK_SLOP_PX = 3

/** A thumb narrower than this is not worth aiming at, however deep the zoom. */
const MIN_THUMB_PX = 24

/**
 * Zooming out past fit-to-width, to where the media occupies a quarter of the
 * track. Stopping at fit-to-width means a clip can never be seen as short:
 * whatever its length it fills the strip, so there is no sense of how much
 * room is left beside it.
 */
const MIN_ZOOM = 0.25

/**
 * Where each frame of the filmstrip band comes from, laid left to right.
 *
 * Frames keep their own aspect ratio and repeat once the clip is wider than
 * the sheet has frames for. Scaling the sheet to the clip's width instead is
 * what squashed every face: the sheet is
 * FILMSTRIP_FRAMES frames wide no matter how many pixels the clip occupies,
 * so the two only agree by accident.
 */
function filmstripTiles(
  clipWidthPx: number,
  aspect: number,
  visibleFromPx: number,
  visibleToPx: number
): { frameWidth: number; first: number; sources: number[] } {
  const frameWidth = Math.max(1, Math.round(STRIP_BAND_HEIGHT * aspect))
  const count = Math.max(1, Math.ceil(clipWidthPx / frameWidth))
  // Only the tiles inside the window are built. Zoomed all the way in a clip
  // is hundreds of thousands of pixels wide, and every tile is a DOM node.
  const first = Math.max(0, Math.floor(visibleFromPx / frameWidth))
  const last = Math.min(count - 1, Math.ceil(visibleToPx / frameWidth))
  const sources: number[] = []
  for (let index = first; index <= last; index += 1) {
    sources.push(
      Math.min(FILMSTRIP_FRAMES - 1, Math.floor(((index + 0.5) / count) * FILMSTRIP_FRAMES))
    )
  }
  return { frameWidth, first, sources }
}

/** A clip as the timeline draws it: its position plus its asset's artwork. */
export interface TimelineClipView {
  id: string
  startMs: number
  durationMs: number
  name: string
  /** Row of frames for the clip's body; null until generated. */
  filmstripUrl: string | null
  /** White-on-transparent envelope, tinted here; null until generated. */
  waveformUrl: string | null
  /** Frame width over height, for laying the filmstrip out undistorted. */
  aspect: number
  missing: boolean
}

interface TimelineProps {
  durationMs: number
  clips: TimelineClipView[]
  /** Already on the timeline's clock — see lib/timeline.ts layUtterances. */
  utterances: Utterance[]
  selectedClipIds: string[]
  /** Timeline utterance ids, i.e. what layUtterances produced. */
  selectedUtteranceIds: string[]
  videoRef: RefObject<HTMLVideoElement | null>
  onSelectClips(clipIds: string[]): void
  onRemoveClips(clipIds: string[]): void
  onSelectUtterances(ids: string[]): void
  onRemoveUtterances(ids: string[]): void
  /**
   * The time the playhead was just moved to by a click or drag, reported the
   * moment it happens rather than when the element catches up.
   */
  onScrub(timeMs: number): void
  /** Move playback to this timeline position; the clip switch is not ours. */
  onSeek(timelineMs: number): void
  /**
   * Where the clip the element is currently playing starts on the timeline.
   * The element's own clock restarts at zero on every clip, so without this
   * the playhead would jump back to the left at each boundary.
   */
  clipOffsetMs: number
  /**
   * Whether a `<video>` is on screen. The playhead listens to that element, and
   * it does not exist until the timeline has a playable clip.
   */
  hasPlayer: boolean
  /** Space, while the strip has focus. */
  onTogglePlay(): void
  /** An asset was dragged here from the media library. */
  onDropAsset(assetId: string): void
  /**
   * A press landed on a subtitle block, with the time it snapped to. Opening
   * the editor is a single click: the block is a few pixels wide, and asking
   * for two hits on it inside the platform's double-click window was the
   * larger half of "subtitles are hard to click".
   */
  onEditSubtitlesAt(timeMs: number): void
}

/**
 * One lane: a fixed head naming the track, and the content area the clips are
 * positioned in. The head is inside the scale-free region deliberately — it
 * must not move when the content is scaled or scrolled.
 */
function TimelineTrack({
  icon,
  label,
  main,
  hidden,
  contentWidth,
  offsetPx,
  contentRef,
  children
}: {
  icon: JSX.Element
  label: string
  main?: boolean
  hidden?: boolean
  /** The window, for hit-testing the rubber band against this row. */
  contentRef?: RefObject<HTMLDivElement | null>
  /** Width of the whole timeline at the current zoom, in pixels. */
  contentWidth: number
  /** How far the view is scrolled into it. */
  offsetPx: number
  children: ReactNode
}): JSX.Element | null {
  if (hidden === true) return null
  return (
    <div
      className="flex"
      style={{
        height: main ? 'var(--timeline-media-height)' : 'var(--timeline-subtitle-height)'
      }}
    >
      <div
        className="flex shrink-0 items-center gap-inline px-component text-muted-foreground"
        style={{ width: 'var(--timeline-head-width)' }}
        title={label}
      >
        {icon}
      </div>
      {/* Two layers: a fixed window, and the full-width strip sliding inside
          it. Clips position themselves in percentages of the strip, so they
          need no knowledge of the zoom or the scroll at all. */}
      <div ref={contentRef} className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-y-0" style={{ left: -offsetPx, width: contentWidth }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function Timeline({
  durationMs,
  utterances,
  clips,
  selectedClipIds,
  selectedUtteranceIds,
  videoRef,
  onSelectClips,
  onRemoveClips,
  onSelectUtterances,
  onRemoveUtterances,
  onScrub,
  onSeek,
  clipOffsetMs,
  hasPlayer,
  onTogglePlay,
  onDropAsset,
  onEditSubtitlesAt
}: TimelineProps): JSX.Element {
  const [dropTarget, setDropTarget] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  /** The area clips occupy, i.e. everything right of the track heads. All
   *  time↔pixel conversion is against this, never the whole container. */
  const contentRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  /**
   * What the drag that is running means. Fixed at pointerdown by where the
   * press landed, and never reconsidered: a gesture that changed meaning
   * halfway through would be unusable.
   */
  const dragRef = useRef<'scrub' | 'marquee' | 'none'>('none')
  /**
   * A press that has not yet turned into a drag. Outside the ruler the
   * playhead must not move until the press is known to be a click — dragging
   * to select is not a request to seek.
   */
  const pendingClickRef = useRef<{
    timeMs: number
    clientX: number
    clientY: number
    subtitle: boolean
  } | null>(null)
  /** Where the band began, in client pixels, so hit tests survive a scroll. */
  const marqueeStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  /** The rows' windows; the band has to touch one to take anything from it. */
  const mediaRowRef = useRef<HTMLDivElement>(null)
  const subtitleRowRef = useRef<HTMLDivElement>(null)
  /** The rubber band, in container-relative pixels. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  )
  /** Latest scrub target, and the frame that will hand it to the element. */
  const pendingSeekRef = useRef<number | null>(null)
  const seekFrameRef = useRef(0)
  const [width, setWidth] = useState(0)
  /** 1 is fit-to-width; above that the strip is longer than the window. */
  const [zoom, setZoom] = useState(1)
  /** How far the window is scrolled into the strip, in strip pixels. */
  const [offsetPx, setOffsetPx] = useState(0)
  const hasMedia = durationMs > 0

  const contentWidth = width * zoom
  const maxOffset = Math.max(0, contentWidth - width)

  /**
   * Enough that a pixel is a millisecond, which is finer than anything the
   * timeline can express. Capped as well, because a short clip would otherwise
   * allow a zoom so deep that the strip is megapixels wide.
   */
  const maxZoom = width > 0 && durationMs > 0 ? Math.max(1, Math.min(500, durationMs / width)) : 1

  // Read by the wheel listener and the playhead writer, both of which run
  // outside the render that produced these numbers.
  const viewRef = useRef({ width, contentWidth, offsetPx, zoom, durationMs, maxZoom })
  viewRef.current = { width, contentWidth, offsetPx, zoom, durationMs, maxZoom }

  // Shrinking the window, or zooming back out, can leave the view scrolled
  // past the end of a strip that is now shorter than the offset.
  useEffect(() => {
    setOffsetPx((current) => Math.min(current, Math.max(0, contentWidth - width)))
  }, [contentWidth, width])

  useEffect(() => {
    return () => {
      if (seekFrameRef.current !== 0) cancelAnimationFrame(seekFrameRef.current)
    }
  }, [])

  // Depends on hasMedia because the ruler that carries contentRef is not in
  // the tree until something is laid down; a mount-only effect would observe
  // nothing and leave the scale at zero forever.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [hasMedia])

  const scale = pxPerMs(contentWidth, durationMs)

  // Written straight to the DOM: this runs every animation frame during
  // playback and must not re-render the tree.
  const movePlayhead = useCallback((timeMs: number) => {
    const playhead = playheadRef.current
    const view = viewRef.current
    if (!playhead || !(view.durationMs > 0)) return
    const ratio = Math.max(0, Math.min(1, timeMs / view.durationMs))
    playhead.style.transform = `translateX(${ratio * view.contentWidth - view.offsetPx}px)`
  }, [])

  // Through a ref so the tick callback stays stable across clip switches.
  const clipOffsetRef = useRef(clipOffsetMs)
  clipOffsetRef.current = clipOffsetMs
  const onTick = useCallback(
    (elementMs: number) => movePlayhead(clipOffsetRef.current + elementMs),
    [movePlayhead]
  )
  // Re-attaches when the player appears; see usePlaybackClock.
  usePlaybackClock(videoRef, onTick, hasPlayer)

  // Zooming and scrolling move where a given instant sits without the element
  // reporting anything, and the playhead is written imperatively — it is only
  // repainted by playback events. Without this it keeps the position it was
  // given under the previous geometry and drifts away from the ruler.
  useEffect(() => {
    const video = videoRef.current
    movePlayhead(clipOffsetRef.current + (video ? video.currentTime * 1000 : 0))
  }, [contentWidth, offsetPx, movePlayhead, videoRef])

  // Only the window's own span: zoomed in, the strip holds thousands of
  // labels and all but a screenful are off-screen; zoomed out below
  // fit-to-width, the window runs past the media and the ruler carries on.
  const ticks = useMemo(() => {
    if (scale <= 0) return []
    return tickTimes(offsetPx / scale, (offsetPx + width) / scale, pickTickInterval(scale))
  }, [scale, offsetPx, width])

  const blocks = useMemo(
    // MIN_BLOCK_PX is passed rather than left to default: merging has to know
    // the same minimum the render applies, or the two disagree and blocks
    // that were kept apart get drawn on top of each other.
    () => (scale > 0 ? mergeBlocks(utterances, scale, MIN_BLOCK_PX) : []),
    [utterances, scale]
  )

  const timeAtClientX = (clientX: number): number => {
    const content = contentRef.current
    if (!content || durationMs <= 0 || contentWidth <= 0) return 0
    const rect = content.getBoundingClientRect()
    const ratio = (clientX - rect.left + offsetPx) / contentWidth
    return Math.max(0, Math.min(1, ratio)) * durationMs
  }

  /**
   * Everything the user can see moves now; only the element's own seek waits.
   *
   * The playhead and the subtitle highlight are driven from the pointer, not
   * from the element: `timeupdate` fires about 4Hz and only once a seek has
   * finished, so a 60Hz drag hung on it looks like it is stuttering. The
   * `currentTime` write is coalesced to one per frame — asking a multi-gigabyte
   * file to seek on every pointermove is what makes the drag itself stutter.
   */
  const seekTo = (timeMs: number): void => {
    movePlayhead(timeMs)
    onScrub(timeMs)

    pendingSeekRef.current = timeMs
    if (seekFrameRef.current !== 0) return
    seekFrameRef.current = requestAnimationFrame(() => {
      seekFrameRef.current = 0
      const target = pendingSeekRef.current
      if (target !== null) onSeek(target)
    })
  }

  /**
   * Pressing a subtitle block means "this line", so it snaps to the line's own
   * start; pressing anywhere else is a free scrub and stays exact.
   *
   * The snap is what keeps the block highlighted afterwards. A block is not
   * the same span as its utterance — MIN_BLOCK_PX widens short lines, merged
   * blocks span the silence between lines — so the exact time under the
   * pointer regularly falls outside every utterance, and the highlight, which
   * is a strict containment test, clears the moment the playhead lands there.
   */
  const pressTimeOf = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const timeMs = timeAtClientX(event.clientX)
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-subtitle-block]')) return timeMs
    const index = findNearestUtteranceIndex(utterances, timeMs)
    return index === -1 ? timeMs : (utterances[index]?.start ?? timeMs)
  }

  /** Container-relative pixels, which is what the rubber band is drawn in. */
  const localPointOf = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  /** Position along the whole strip, unclamped — a band can lie past the end. */
  const stripXAt = (clientX: number): number => {
    const rect = contentRef.current?.getBoundingClientRect()
    return clientX - (rect?.left ?? 0) + offsetPx
  }

  /** True when the band's vertical span reaches the given row at all. */
  const bandReaches = (
    row: RefObject<HTMLDivElement | null>,
    fromClientY: number,
    toClientY: number
  ): boolean => {
    const rect = row.current?.getBoundingClientRect()
    if (!rect) return false
    return (
      Math.max(fromClientY, toClientY) >= rect.top &&
      Math.min(fromClientY, toClientY) <= rect.bottom
    )
  }

  /** The band's horizontal reach, in strip pixels. */
  const bandSpan = (
    fromClientX: number,
    toClientX: number
  ): { from: number; to: number } | null => {
    if (scale <= 0) return null
    const a = stripXAt(fromClientX)
    const b = stripXAt(toClientX)
    return { from: Math.min(a, b), to: Math.max(a, b) }
  }

  /**
   * What the band covers, resolved per row: horizontal overlap plus a vertical
   * hit on that row. A band drawn entirely in the empty space above the tracks
   * takes nothing, which is why the vertical test cannot be skipped.
   */
  const clipsWithin = (
    fromClientX: number,
    toClientX: number,
    fromClientY: number,
    toClientY: number
  ): string[] => {
    const span = bandSpan(fromClientX, toClientX)
    if (!span || !bandReaches(mediaRowRef, fromClientY, toClientY)) return []
    return clips
      .filter((clip) => {
        const left = clip.startMs * scale
        return left + clip.durationMs * scale >= span.from && left <= span.to
      })
      .map((clip) => clip.id)
  }

  const utterancesWithin = (
    fromClientX: number,
    toClientX: number,
    fromClientY: number,
    toClientY: number
  ): string[] => {
    const span = bandSpan(fromClientX, toClientX)
    if (!span || !bandReaches(subtitleRowRef, fromClientY, toClientY)) return []
    return utterances
      .filter(
        (utterance) => utterance.end * scale >= span.from && utterance.start * scale <= span.to
      )
      .map((utterance) => utterance.id)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (durationMs <= 0) return
    // Track heads are left of the scale. Without this, pressing one converts
    // to a negative time, clamps to zero and jumps playback to the start.
    const content = contentRef.current
    if (content && event.clientX < content.getBoundingClientRect().left) return

    // Pressing anywhere in the strip settles what is selected: a clip if the
    // press landed on one, nothing if it landed on empty track.
    const target = event.target
    const element = target instanceof Element ? target.closest('[data-clip-id]') : null
    const clipId = element?.getAttribute('data-clip-id') ?? null
    onSelectClips(clipId === null ? [] : [clipId])
    const block = target instanceof Element ? target.closest('[data-subtitle-ids]') : null
    const blockIds = block?.getAttribute('data-subtitle-ids')
    onSelectUtterances(blockIds ? blockIds.split(' ') : [])

    // What the drag will mean, decided here and only here. Only the ruler
    // drags the playhead: dragging a scrub out of the tracks would fight the
    // rubber band for the same gesture, and the ruler is where a desktop
    // editor puts it anyway. On a clip the press has already selected it and
    // there is nothing to drag, since clips cannot be moved.
    const rulerBottom = content?.getBoundingClientRect().bottom ?? 0
    dragRef.current = event.clientY <= rulerBottom ? 'scrub' : clipId === null ? 'marquee' : 'none'

    const timeMs = pressTimeOf(event)
    if (dragRef.current === 'scrub') {
      // The ruler is unambiguous, so it moves at once and stays under the
      // pointer for the rest of the drag.
      seekTo(timeMs)
    } else {
      // Everywhere else the press is held back: it becomes a seek on release,
      // and only if it never turned into a drag.
      pendingClickRef.current = {
        timeMs,
        clientX: event.clientX,
        clientY: event.clientY,
        subtitle: target instanceof Element && target.closest('[data-subtitle-block]') !== null
      }
    }

    if (dragRef.current === 'marquee') {
      const point = localPointOf(event)
      marqueeStartRef.current = { clientX: event.clientX, clientY: event.clientY }
      setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return

    const pending = pendingClickRef.current
    if (
      pending &&
      Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) > CLICK_SLOP_PX
    ) {
      pendingClickRef.current = null
    }

    // Dragging never snaps: scrubbing has to follow the pointer exactly.
    if (dragRef.current === 'scrub') {
      seekTo(timeAtClientX(event.clientX))
      return
    }
    if (dragRef.current !== 'marquee') return

    const point = localPointOf(event)
    setMarquee((current) => (current ? { ...current, x1: point.x, y1: point.y } : current))
    // Live rather than on release, so the band shows what it is about to take.
    setMarqueeSelection(event)
  }

  /** Reads the band's own corners from the ref to avoid a stale closure. */
  const setMarqueeSelection = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = marqueeStartRef.current
    if (!start) return
    onSelectClips(clipsWithin(start.clientX, event.clientX, start.clientY, event.clientY))
    onSelectUtterances(utterancesWithin(start.clientX, event.clientX, start.clientY, event.clientY))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Still pending means the press never became a drag, so it was a click.
    const pending = pendingClickRef.current
    if (pending) {
      seekTo(pending.timeMs)
      // Clicking a subtitle opens the editor on it — one press, not two.
      if (pending.subtitle) onEditSubtitlesAt(pending.timeMs)
    }
    pendingClickRef.current = null
    dragRef.current = 'none'
    marqueeStartRef.current = null
    setMarquee(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // dragover has to preventDefault on every event or the drop never fires,
  // and it may only look at dataTransfer.types — the payload is unreadable
  // until the drop itself.
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(MEDIA_ASSET_DRAG)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropTarget(true)
  }

  // The strip takes focus on press (tabIndex), which is what makes Delete
  // reach here at all rather than the document.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Space is the one shortcut that needs nothing selected: the strip having
    // focus is enough. preventDefault, or the page scrolls with it.
    if (event.key === ' ') {
      event.preventDefault()
      onTogglePlay()
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (selectedClipIds.length === 0 && selectedUtteranceIds.length === 0) return
    event.preventDefault()
    // A band can cover both rows, so one press clears whatever it took.
    if (selectedUtteranceIds.length > 0) onRemoveUtterances(selectedUtteranceIds)
    if (selectedClipIds.length > 0) onRemoveClips(selectedClipIds)
  }

  /**
   * Wheel with the middle button held (or Cmd/Ctrl) zooms; otherwise the wheel
   * pans, which only does anything once zoomed in past the window.
   *
   * Bound natively rather than through onWheel because React registers wheel
   * listeners as passive, and a passive listener cannot preventDefault — which
   * both branches need, or the gesture reaches the page behind.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (event: WheelEvent): void => {
      const view = viewRef.current
      if (!(view.durationMs > 0) || view.width <= 0) return

      // buttons is a bitmask; 4 is the middle button.
      const zooming = (event.buttons & 4) !== 0 || event.ctrlKey || event.metaKey
      event.preventDefault()

      if (!zooming) {
        // A trackpad reports sideways scrolling on deltaX; a wheel has only
        // deltaY, so Shift is the usual stand-in for it.
        const delta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
        if (delta === 0) return
        const limit = Math.max(0, view.contentWidth - view.width)
        setOffsetPx((current) => Math.max(0, Math.min(limit, current + delta)))
        return
      }

      const content = contentRef.current
      if (!content) return
      // Zoom around the pointer: the instant under it must not move, or
      // zooming in on something walks it off the screen.
      const anchorPx = event.clientX - content.getBoundingClientRect().left
      const anchorRatio = (anchorPx + view.offsetPx) / view.contentWidth
      const next = Math.max(
        MIN_ZOOM,
        Math.min(view.maxZoom, view.zoom * Math.exp(-event.deltaY * 0.002))
      )
      const nextWidth = view.width * next
      setZoom(next)
      setOffsetPx(
        Math.max(
          0,
          Math.min(Math.max(0, nextWidth - view.width), anchorRatio * nextWidth - anchorPx)
        )
      )
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  /** Last pointer x while dragging the scrollbar thumb. */
  const thumbXRef = useRef<number | null>(null)

  const handleThumbDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    thumbXRef.current = event.clientX
  }

  const handleThumbMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const last = thumbXRef.current
    if (last === null || width <= 0) return
    event.stopPropagation()
    thumbXRef.current = event.clientX
    // The thumb travels the window's width while the view travels the strip's,
    // so a pixel of thumb is `zoom` pixels of strip.
    const delta = ((event.clientX - last) * contentWidth) / width
    setOffsetPx((current) => Math.max(0, Math.min(maxOffset, current + delta)))
  }

  const handleThumbUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    thumbXRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** Pressing the empty part of the bar centres the thumb there. */
  const jumpScrollbarTo = (clientX: number): void => {
    const content = contentRef.current
    if (!content || width <= 0) return
    const ratio = (clientX - content.getBoundingClientRect().left) / width
    setOffsetPx(Math.max(0, Math.min(maxOffset, ratio * contentWidth - width / 2)))
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const assetId = event.dataTransfer.getData(MEDIA_ASSET_DRAG)
    setDropTarget(false)
    if (assetId === '') return
    event.preventDefault()
    onDropAsset(assetId)
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative flex h-full flex-col touch-none overflow-hidden outline-none select-none"
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={handleDrop}
    >
      {/* Ruler, tracks and playhead share one box so the playhead spans them
          and stops short of the scrollbar. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* One continuous rule between the heads and the tracks. Per-row
            borders leave it broken wherever a row is missing — and the rows
            are centred, so most of that column has no row in it at all. */}
        {hasMedia && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: 'calc(var(--timeline-head-width) - 1px)' }}
          />
        )}
        {/* Ruler. Its left spacer keeps the scale aligned with the tracks below.
          An empty timeline has no scale to show, so it has no ruler either —
          and it must be removed from the tree, not `hidden`: Tailwind's
          Preflight writes that rule through :where(), so any display utility
          on the element outranks it. */}
        {hasMedia && (
          <div
            className="flex border-b border-border"
            style={{ height: 'var(--timeline-ruler-height)' }}
          >
            <div className="shrink-0" style={{ width: 'var(--timeline-head-width)' }} />
            {/* contentRef is the window, not the strip: it is what the pointer
              is measured against and what ResizeObserver watches. */}
            <div ref={contentRef} className="relative min-w-0 flex-1 overflow-hidden">
              <div className="absolute inset-y-0" style={{ left: -offsetPx, width: contentWidth }}>
                {ticks.map((time) => (
                  <span
                    key={time}
                    className="timecode absolute top-0 pl-inline text-muted-foreground"
                    style={{ left: `${(time / durationMs) * 100}%` }}
                  >
                    {formatTimecode(time)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tracks sit centred in whatever height is left, so growing the panel
          pads above and below rather than leaving them stranded at the top. */}
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          {/* Nothing laid down yet. The placeholder is shaped like the track it
            is about to become — same height, same offset past the heads — so
            dropping does not make the strip jump. It is also the only place
            that says how to start, since importing no longer does it. */}
          {!hasMedia && (
            <div className="flex" style={{ height: 'var(--timeline-media-height)' }}>
              <div className="shrink-0" style={{ width: 'var(--timeline-head-width)' }} />
              <div
                className={`flex min-w-0 flex-1 items-center gap-component rounded-xs border border-dashed px-inset transition-colors ${
                  dropTarget ? 'border-primary bg-primary/10' : 'border-border'
                }`}
              >
                <Film size={16} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-caption font-normal text-muted-foreground">
                  Drag a video here to start editing.
                </span>
              </div>
            </div>
          )}

          {/* Secondary track: subtitles. One block per line, adjacent ones merged.
            It only exists once there are subtitles — an empty lane with a head
            on it reads as a feature that is broken rather than one not used
            yet. */}
          <TimelineTrack
            icon={<Type size={13} />}
            label="Subtitles"
            hidden={!hasMedia || utterances.length === 0}
            contentWidth={contentWidth}
            offsetPx={offsetPx}
            contentRef={subtitleRowRef}
          >
            {blocks.map((block) => (
              <div
                key={block.startMs}
                data-subtitle-block
                // The lines this drawing stands for, so a press can select
                // them without re-deriving which ones it covers.
                data-subtitle-ids={block.ids.join(' ')}
                className={`absolute inset-y-adjust flex items-center overflow-hidden rounded-xs ${
                  block.ids.some((id) => selectedUtteranceIds.includes(id))
                    ? 'ring-1 ring-foreground ring-inset'
                    : ''
                }`}
                style={{
                  left: `${(block.startMs / durationMs) * 100}%`,
                  width: `${((block.endMs - block.startMs) / durationMs) * 100}%`,
                  minWidth: MIN_BLOCK_PX,
                  background: 'var(--editor-waveform)'
                }}
              >
                {/* The line itself, once the block is wide enough to hold any
                    of it. Merged blocks carry no text (see lib/timeline.ts), so
                    this is only ever one line's own words. */}
                {block.text !== '' && (block.endMs - block.startMs) * scale >= MIN_CAPTION_PX && (
                  <span className="pointer-events-none block truncate px-inline text-caption leading-[var(--timeline-subtitle-height)] text-white">
                    {block.text}
                  </span>
                )}
              </div>
            ))}
          </TimelineTrack>

          {/* Main track: a caption bar, the filmstrip, then the audio envelope.
            The three band heights are tokens and sum to the track height, so
            the clip has no internal flex — each band is exactly its own
            height whatever the panel is doing. */}
          <TimelineTrack
            icon={<Film size={13} />}
            label="Video"
            main
            hidden={!hasMedia}
            contentWidth={contentWidth}
            offsetPx={offsetPx}
            contentRef={mediaRowRef}
          >
            {clips.map((clip) => (
              <div
                key={clip.id}
                data-clip-id={clip.id}
                className="absolute inset-y-0 flex flex-col overflow-hidden rounded-xs"
                style={{
                  left: `${(clip.startMs / durationMs) * 100}%`,
                  width: `${(clip.durationMs / durationMs) * 100}%`,
                  background: 'var(--editor-waveform-muted)'
                }}
              >
                <div
                  className="flex shrink-0 items-center gap-component overflow-hidden px-inline"
                  style={{ height: 'var(--timeline-media-header-height)' }}
                >
                  <span className="truncate text-caption font-normal text-foreground">
                    {clip.name}
                  </span>
                  <span className="timecode shrink-0 text-muted-foreground">
                    {formatTimecode(clip.durationMs)}
                  </span>
                </div>

                <div
                  className="relative shrink-0 overflow-hidden"
                  style={{ height: 'var(--timeline-media-strip-height)' }}
                >
                  {clip.filmstripUrl !== null &&
                    (() => {
                      const clipLeftPx = contentWidth * (clip.startMs / durationMs)
                      const clipWidthPx = contentWidth * (clip.durationMs / durationMs)
                      const { frameWidth, first, sources } = filmstripTiles(
                        clipWidthPx,
                        clip.aspect,
                        offsetPx - clipLeftPx,
                        offsetPx + width - clipLeftPx
                      )
                      return sources.map((source, index) => (
                        <div
                          key={first + index}
                          className="absolute top-0 bottom-0"
                          style={{
                            left: (first + index) * frameWidth,
                            width: frameWidth,
                            backgroundImage: `url("${clip.filmstripUrl}")`,
                            // The sheet is scaled so one frame is exactly
                            // frameWidth wide, then shifted to the wanted one.
                            backgroundSize: `${FILMSTRIP_FRAMES * frameWidth}px 100%`,
                            backgroundPosition: `-${source * frameWidth}px 0`,
                            backgroundRepeat: 'no-repeat'
                          }}
                        />
                      ))
                    })()}
                </div>

                {clip.waveformUrl && (
                  // The PNG is white on transparent; masking lets it take the
                  // theme's waveform colour instead of shipping one per theme.
                  <div
                    className="shrink-0"
                    style={{
                      height: 'var(--timeline-media-wave-height)',
                      background: 'var(--editor-waveform)',
                      maskImage: `url("${clip.waveformUrl}")`,
                      maskSize: '100% 100%',
                      WebkitMaskImage: `url("${clip.waveformUrl}")`,
                      WebkitMaskSize: '100% 100%'
                    }}
                  />
                )}

                {/* Selection is its own layer, stacked over the bands, rather
                    than a border or outline on the clip itself.

                    Both of those are drawn by the clip and covered by its own
                    children: an inset ring is a box-shadow, which paints
                    under them outright, and an outline — which the spec does
                    paint last — still loses to positioned descendants on their
                    own paint layers, which the filmstrip tiles are. A sibling
                    with a z-index is the only version that does not depend on
                    reading paint order correctly. */}
                {selectedClipIds.includes(clip.id) && (
                  <div className="pointer-events-none absolute inset-0 z-10 rounded-xs border border-foreground" />
                )}
              </div>
            ))}
          </TimelineTrack>
        </div>

        {/* The rubber band. Drawn over the tracks deliberately: covering what it
          is about to take is exactly how it says what it covers. */}
        {marquee && (
          <div
            className="pointer-events-none absolute border border-primary bg-primary/20"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0)
            }}
          />
        )}

        {/* Playhead spans every track, offset past the heads. Its window clips
          it: once the view is scrolled, the marker's own translate goes
          negative and it would otherwise be drawn across the track heads. */}
        {durationMs > 0 && (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 overflow-hidden"
            style={{ left: 'var(--timeline-head-width)' }}
          >
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px"
              style={{ background: 'var(--editor-playhead)' }}
            >
              {/* A grip at the top, sitting in the ruler. A bare hairline is
                  hard to pick out among the ticks and gives no hint that the
                  marker is the thing you drag.
                  A bar tapering to a point, so the grip names the exact
                  instant the way a plain block cannot. The shoulder is the bar
                  token rather than a percentage, so changing either height
                  leaves the other alone. Centred on the line by half its
                  width, so the tokens can change freely. */}
              <div
                className="absolute top-0 -translate-x-1/2"
                style={{
                  width: 'var(--timeline-playhead-handle-width)',
                  height:
                    'calc(var(--timeline-playhead-handle-bar) + var(--timeline-playhead-handle-point))',
                  background: 'var(--editor-playhead)',
                  clipPath:
                    'polygon(0 0, 100% 0, 100% var(--timeline-playhead-handle-bar), 50% 100%, 0 var(--timeline-playhead-handle-bar))'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Horizontal scrollbar. Drawn rather than delegated to overflow-x
          because the strip is moved by transform, not by a scroll container —
          and a mouse has no deltaX, so wheel panning alone leaves the zoomed
          timeline unreachable. */}
      {hasMedia && (
        <div
          className="relative shrink-0"
          style={{
            height: 'var(--timeline-scrollbar-height)',
            marginLeft: 'var(--timeline-head-width)'
          }}
          onPointerDown={(event) => {
            // Without this the press also reaches the strip and seeks.
            event.stopPropagation()
            if (event.target === event.currentTarget) jumpScrollbarTo(event.clientX)
          }}
        >
          <div
            role="scrollbar"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(maxOffset > 0 ? (offsetPx / maxOffset) * 100 : 0)}
            className="absolute inset-y-adjust cursor-grab rounded-full bg-border transition-colors hover:bg-input active:cursor-grabbing"
            style={{
              left: contentWidth > 0 ? `${(offsetPx / contentWidth) * 100}%` : 0,
              // Capped: below fit-to-width the strip is shorter than the
              // window, and the thumb would otherwise overrun the bar.
              width: contentWidth > 0 ? `${Math.min(1, width / contentWidth) * 100}%` : '100%',
              minWidth: MIN_THUMB_PX
            }}
            onPointerDown={handleThumbDown}
            onPointerMove={handleThumbMove}
            onPointerUp={handleThumbUp}
            onPointerCancel={handleThumbUp}
          />
        </div>
      )}
    </div>
  )
}
