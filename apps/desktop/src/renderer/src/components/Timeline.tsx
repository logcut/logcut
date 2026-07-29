import {
  clampUtteranceTime,
  findNearestUtteranceIndex,
  formatTimecode,
  SNAP_TOLERANCE_PX,
  snapToNearest,
  utteranceEdges
} from '@logcut/core'
import type { Utterance } from '@logcut/core'
import Waveform from '@/components/Waveform'
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
import { pickTickInterval, pxPerMs, subtitleBlocks, tickTimes } from '@/lib/timeline'
import { FILMSTRIP_FRAMES } from '../../../shared/media'

/** Width below which a block does not get its text (see Timeline.md).
 *  **A threshold for showing the text, not a floor on the block** — read as a
 *  minimum width it puts short lines back on top of their neighbours. */
const MIN_CAPTION_PX = 28

/** The white bar at a selected line's edge, and the wider strip that actually
 *  takes the drag — a 3px target is not something anyone can hit, which is why
 *  the two are separate. See Timeline.md. */
const TRIM_BAR_PX = 3
const TRIM_HIT_PX = 8

/** How far the selection plate stands proud above and below the line. */
const SELECTION_EDGE_PX = 1

/** Mirrors --timeline-media-strip-height; the frame maths needs the number. */
const STRIP_BAND_HEIGHT = 39

/** How far the pointer may wander and still count as a click — the hand slips
 *  a pixel or two on the way up (see Timeline.md). */
const CLICK_SLOP_PX = 3

/** A thumb narrower than this is not worth aiming at, however deep the zoom. */
const MIN_THUMB_PX = 24

/** Zooming out past fit-to-width, to a quarter of the track — see Timeline.md. */
const MIN_ZOOM = 0.25

/** Where each frame of the filmstrip band comes from, laid left to right.
 *  **Frames keep their own aspect ratio and repeat**, rather than the sheet
 *  being scaled to the clip's width — see Timeline.md. */
function filmstripTiles(
  clipWidthPx: number,
  aspect: number,
  visibleFromPx: number,
  visibleToPx: number
): { frameWidth: number; first: number; sources: number[] } {
  const frameWidth = Math.max(1, Math.round(STRIP_BAND_HEIGHT * aspect))
  const count = Math.max(1, Math.ceil(clipWidthPx / frameWidth))
  // Only the tiles inside the window are built — one of the three things that
  // must be culled to the viewport (see Timeline.md).
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
  peaks: Uint8Array | null
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
  /** The time the playhead was just moved to, reported the moment it happens
   *  rather than when the element catches up — see Timeline.md. */
  onScrub(timeMs: number): void
  /** Move playback to this timeline position; the clip switch is not ours. */
  onSeek(timelineMs: number): void
  /**
   * Where the clip the element is currently playing starts on the timeline.
   * The element's own clock restarts at zero on every clip, so without this
   * the playhead would jump back to the left at each boundary.
   */
  clipOffsetMs: number
  /** Whether a `<video>` is on screen; the playhead listens to that element —
   *  see hooks/usePlaybackClock.md. */
  hasPlayer: boolean
  /** Subtitle edges were dragged to new times, on the timeline's clock. */
  onTrimUtterances(edge: 'start' | 'end', changes: { id: string; timeMs: number }[]): void
  /** Space, while the strip has focus. */
  onTogglePlay(): void
  /** An asset was dragged here from the media library. */
  onDropAsset(assetId: string): void
  /** A press landed on a subtitle block, with the time it snapped to. A single
   *  click, not a double — see Timeline.md. */
  onEditSubtitlesAt(timeMs: number): void
  /** Whether drags land on nearby landmarks. Off is a real working mode — a
   *  line placed deliberately a few frames off an edge cannot be nudged there
   *  while every drag keeps pulling it back. */
  snapEnabled: boolean
}

/** One lane: a fixed head, and the content area the clips are positioned in.
 *  The head sits outside everything the scale touches — see Timeline.md. */
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
      {/* A fixed window with the full-width strip sliding inside it — see
          Timeline.md. */}
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
  onTrimUtterances,
  onTogglePlay,
  onDropAsset,
  onEditSubtitlesAt,
  snapEnabled
}: TimelineProps): JSX.Element {
  const [dropTarget, setDropTarget] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  /** The window, i.e. everything right of the track heads. **All time↔pixel
   *  conversion is against this, never the whole container.** */
  const contentRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  /** Where the playhead is, in timeline ms. A ref, not state: it changes every
   *  animation frame during playback and must not re-render anything. */
  const playheadMsRef = useRef(0)
  /** What the running drag means. Fixed at pointerdown by where the press
   *  landed, and **never reconsidered** on move (see Timeline.md). */
  const dragRef = useRef<'scrub' | 'marquee' | 'trim' | 'none'>('none')
  /** The edge being dragged, everything it moves, and how far — a shift, not a
   *  destination, and held here until release so a drag is one undo step
   *  (see Timeline.md). */
  const [trim, setTrim] = useState<{
    edge: 'start' | 'end'
    ids: string[]
    /** The pressed edge's own value, which the pointer is measured against. */
    originMs: number
    deltaMs: number
  } | null>(null)
  /** A press that has not yet turned into a drag. Outside the ruler the playhead
   *  must not move until the press is known to be a click (see Timeline.md). */
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
  /** The window width the scale is fitted to, which is **not** the window's
   *  current width: folding this back into `width` is what makes a resize
   *  rescale the strip (see Timeline.md). */
  const [baseWidth, setBaseWidth] = useState(0)
  /** 1 is the whole media across `baseWidth`; above that the strip is longer. */
  const [zoom, setZoom] = useState(1)
  /** How far the window is scrolled into the strip, in strip pixels. */
  const [offsetPx, setOffsetPx] = useState(0)
  const hasMedia = durationMs > 0

  const contentWidth = baseWidth * zoom
  const maxOffset = Math.max(0, contentWidth - width)

  /** A pixel per millisecond, with a multiplier cap on top — see Timeline.md. */
  const maxZoom =
    baseWidth > 0 && durationMs > 0 ? Math.max(1, Math.min(500, durationMs / baseWidth)) : 1

  // Read by the wheel listener and the playhead writer, both of which run
  // outside the render that produced these numbers.
  const viewRef = useRef({ width, baseWidth, contentWidth, offsetPx, zoom, durationMs, maxZoom })
  viewRef.current = { width, baseWidth, contentWidth, offsetPx, zoom, durationMs, maxZoom }

  /** The span `baseWidth` was fitted to. Stored as the span rather than as
   *  "is `baseWidth` still 0", which cannot tell "never fitted" apart from
   *  "fitted while the width was 0". */
  const fittedDurationRef = useRef(-1)

  // Fitting happens once per span, never on resize (see Timeline.md).
  useEffect(() => {
    if (width <= 0 || fittedDurationRef.current === durationMs) return
    fittedDurationRef.current = durationMs
    setBaseWidth(width)
    setZoom(1)
    setOffsetPx(0)
  }, [width, durationMs])

  // Widening the window, or zooming back out, can leave the view scrolled past
  // the end of a strip that no longer reaches that far.
  useEffect(() => {
    setOffsetPx((current) => Math.min(current, Math.max(0, contentWidth - width)))
  }, [contentWidth, width])

  useEffect(() => {
    return () => {
      if (seekFrameRef.current !== 0) cancelAnimationFrame(seekFrameRef.current)
    }
  }, [])

  // **Must depend on `hasMedia`**: the ruler that carries contentRef is not in
  // the tree until something is laid down, and a mount-only effect would leave
  // the scale at zero forever (see Timeline.md).
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

  /**
   * The offset we last told React to apply. Between the call and the render
   * that applies it, viewRef.current.offsetPx is stale; without this the
   * auto-follow would re-fire every frame.
   */
  const pendingOffsetRef = useRef<number | null>(null)

  useEffect(() => {
    pendingOffsetRef.current = null
  }, [offsetPx])

  // Written straight to the DOM: this runs every animation frame during
  // playback and must not re-render the tree.
  const movePlayhead = useCallback((timeMs: number, autoFollow: boolean) => {
    // Recorded on the way past because snapping needs to know where the
    // playhead is, and the position itself only exists as a CSS transform.
    playheadMsRef.current = timeMs
    const playhead = playheadRef.current
    const view = viewRef.current
    if (!playhead || !(view.durationMs > 0)) return
    const ratio = Math.max(0, Math.min(1, timeMs / view.durationMs))
    const playheadPx = ratio * view.contentWidth
    const effectiveOffset = pendingOffsetRef.current ?? view.offsetPx
    const playheadInViewPx = playheadPx - effectiveOffset

    // Auto-follow: when the playhead crosses the right edge during playback,
    // scroll so it reappears at the left edge of the next "page". Disabled
    // when the user is manually scrolling — they may want to look ahead.
    if (autoFollow && playheadInViewPx > view.width) {
      const maxOffset = Math.max(0, view.contentWidth - view.width)
      const newOffset = Math.min(maxOffset, playheadPx)
      pendingOffsetRef.current = newOffset
      setOffsetPx(newOffset)
      playhead.style.transform = `translateX(${playheadPx - newOffset}px)`
      return
    }

    playhead.style.transform = `translateX(${playheadInViewPx}px)`
  }, [])

  // Through a ref so the tick callback stays stable across clip switches.
  const clipOffsetRef = useRef(clipOffsetMs)
  clipOffsetRef.current = clipOffsetMs
  const onTick = useCallback(
    (elementMs: number) => movePlayhead(clipOffsetRef.current + elementMs, true),
    [movePlayhead]
  )
  // Re-attaches when the player appears; see usePlaybackClock.
  usePlaybackClock(videoRef, onTick, hasPlayer)

  // The playhead is only repainted by playback events, so every quantity that
  // moves where an instant sits has to redraw it by hand — see Timeline.md.
  useEffect(() => {
    const video = videoRef.current
    movePlayhead(clipOffsetRef.current + (video ? video.currentTime * 1000 : 0), false)
  }, [contentWidth, offsetPx, movePlayhead, videoRef])

  // Only the window's own span — see Timeline.md.
  const ticks = useMemo(() => {
    if (scale <= 0) return []
    return tickTimes(offsetPx / scale, (offsetPx + width) / scale, pickTickInterval(scale))
  }, [scale, offsetPx, width])

  // The drag is previewed by rewriting the lines it moves, so the blocks, the
  // clamping and the neighbours all see one consistent picture and no consumer
  // needs a second "but while dragging" path.
  const shown = useMemo(
    () =>
      trim
        ? utterances.map((utterance) =>
            trim.ids.includes(utterance.id)
              ? { ...utterance, [trim.edge]: utterance[trim.edge] + trim.deltaMs }
              : utterance
          )
        : utterances,
    [utterances, trim]
  )

  const blocks = useMemo(
    () => subtitleBlocks(shown, scale, offsetPx, offsetPx + width),
    [shown, scale, offsetPx, width]
  )

  /**
   * How far from a landmark a drag still lands on it, converted from a fixed
   * pixel distance at the current zoom.
   *
   * **Pixels, never a duration.** A tolerance in milliseconds would cover whole
   * words zoomed in and be imperceptible zoomed out.
   */
  const snapToleranceMs = (): number => (snapEnabled && scale > 0 ? SNAP_TOLERANCE_PX / scale : 0)

  const timeAtClientX = (clientX: number): number => {
    const content = contentRef.current
    if (!content || durationMs <= 0 || contentWidth <= 0) return 0
    const rect = content.getBoundingClientRect()
    const ratio = (clientX - rect.left + offsetPx) / contentWidth
    return Math.max(0, Math.min(1, ratio)) * durationMs
  }

  /** Everything visible moves now; only the element's own seek waits a frame.
   *  The order of the three steps below is load-bearing — see Timeline.md. */
  const seekTo = (timeMs: number): void => {
    movePlayhead(timeMs, false)
    onScrub(timeMs)

    pendingSeekRef.current = timeMs
    if (seekFrameRef.current !== 0) return
    seekFrameRef.current = requestAnimationFrame(() => {
      seekFrameRef.current = 0
      const target = pendingSeekRef.current
      if (target !== null) onSeek(target)
    })
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

  /** What the band covers, resolved per row: horizontal overlap plus a vertical
   *  hit on that row — the vertical test cannot be skipped, see Timeline.md. */
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

  /** The largest shift the pointer is asking for that **no** line in the
   *  selection has to be clamped out of, measured against the pristine list
   *  rather than the preview — see Timeline.md. */
  const allowedTrimDelta = (
    current: { edge: 'start' | 'end'; ids: string[]; originMs: number },
    clientX: number
  ): number => {
    let delta = timeAtClientX(clientX) - current.originMs

    // Snap the edge itself, not the pointer: the two differ by wherever inside
    // the handle the press landed, and it is the edge that has to line up.
    // With several lines dragging together the first one leads and the rest
    // keep their spacing, so the group never comes apart.
    const lead = utterances.find((utterance) => utterance.id === current.ids[0])
    if (lead) {
      const target = lead[current.edge] + delta
      const snapped = snapToNearest(
        target,
        // The playhead first: "line this up with where I am" is the reason to
        // reach for the handle, and it outranks a neighbouring line when both
        // are equally near.
        [playheadMsRef.current, ...utteranceEdges(utterances, current.ids)],
        snapToleranceMs()
      )
      delta += snapped - target
    }

    for (const id of current.ids) {
      const line = utterances.find((utterance) => utterance.id === id)
      if (!line) continue
      const allowed =
        clampUtteranceTime(utterances, id, current.edge, line[current.edge] + delta) -
        line[current.edge]
      if (Math.abs(allowed) < Math.abs(delta)) delta = allowed
    }
    return delta
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (durationMs <= 0) return
    // Track heads are left of the scale. Without this, pressing one converts
    // to a negative time, clamps to zero and jumps playback to the start.
    const content = contentRef.current
    if (content && event.clientX < content.getBoundingClientRect().left) return

    const target = event.target

    // An edge handle takes the gesture outright, and **before anything touches
    // the selection** — it drags the whole selection, so narrowing that down to
    // the pressed line first would throw the rest away (see Timeline.md).
    const handle = target instanceof Element ? target.closest('[data-trim-edge]') : null
    if (handle) {
      const id = handle.getAttribute('data-trim-id')
      const edge = handle.getAttribute('data-trim-edge')
      const line = utterances.find((utterance) => utterance.id === id)
      if (line && (edge === 'start' || edge === 'end')) {
        dragRef.current = 'trim'
        // Handles are only drawn on selected lines, so the pressed one is
        // always among them; the fallback is for safety, not for a real case.
        const ids = selectedUtteranceIds.includes(line.id) ? selectedUtteranceIds : [line.id]
        setTrim({ edge, ids, originMs: line[edge], deltaMs: 0 })
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
    }

    const element = target instanceof Element ? target.closest('[data-clip-id]') : null
    const clipId = element?.getAttribute('data-clip-id') ?? null
    onSelectClips(clipId === null ? [] : [clipId])
    const block = target instanceof Element ? target.closest('[data-subtitle-ids]') : null
    const blockIds = block?.getAttribute('data-subtitle-ids')
    onSelectUtterances(blockIds ? blockIds.split(' ') : [])

    // What the drag will mean, decided here and only here — see Timeline.md.
    const rulerBottom = content?.getBoundingClientRect().bottom ?? 0
    dragRef.current = event.clientY <= rulerBottom ? 'scrub' : clipId === null ? 'marquee' : 'none'

    const timeMs = timeAtClientX(event.clientX)
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

    if (dragRef.current === 'trim') {
      setTrim((current) =>
        current ? { ...current, deltaMs: allowedTrimDelta(current, event.clientX) } : current
      )
      return
    }

    if (dragRef.current === 'scrub') {
      // Snapping in the other direction from a trim: the playhead lands on a
      // subtitle's edge, and every line is a candidate — none is moving.
      seekTo(
        snapToNearest(timeAtClientX(event.clientX), utteranceEdges(utterances), snapToleranceMs())
      )
      return
    }
    if (dragRef.current !== 'marquee') return

    const point = localPointOf(event)
    setMarquee((current) => (current ? { ...current, x1: point.x, y1: point.y } : current))
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
    if (trim) {
      if (trim.deltaMs !== 0) {
        onTrimUtterances(
          trim.edge,
          trim.ids
            .map((id) => utterances.find((utterance) => utterance.id === id))
            .filter((line) => line !== undefined)
            .map((line) => ({ id: line.id, timeMs: line[trim.edge] + trim.deltaMs }))
        )
      }
      setTrim(null)
    }
    // Still pending means the press never became a drag, so it was a click.
    const pending = pendingClickRef.current
    if (pending) {
      // A subtitle click is aimed at the line, not at the instant underneath
      // it, so it leaves the playhead alone — see Timeline.md.
      if (pending.subtitle) onEditSubtitlesAt(pending.timeMs)
      else seekTo(pending.timeMs)
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
    if (selectedUtteranceIds.length > 0) onRemoveUtterances(selectedUtteranceIds)
    if (selectedClipIds.length > 0) onRemoveClips(selectedClipIds)
  }

  /**
   * Wheel: zoom with a modifier, pan otherwise (see Timeline.md).
   *
   * **Bound natively, not through `onWheel`.** React registers wheel listeners
   * as passive, and a passive listener cannot `preventDefault` — which both
   * branches need, or the gesture reaches the page behind.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (event: WheelEvent): void => {
      const view = viewRef.current
      if (!(view.durationMs > 0) || view.contentWidth <= 0) return

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
      // Zoom around the pointer: the instant under it must not move.
      const anchorPx = event.clientX - content.getBoundingClientRect().left
      const anchorRatio = (anchorPx + view.offsetPx) / view.contentWidth
      const next = Math.max(
        MIN_ZOOM,
        Math.min(view.maxZoom, view.zoom * Math.exp(-event.deltaY * 0.002))
      )
      const nextWidth = view.baseWidth * next
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
    // The thumb travels the window's width while the view travels the strip's.
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
      // Takes what is left of the panel rather than all of it: the toolbar
      // above is a sibling, and `h-full` here would push the tracks past the
      // panel's bottom edge by exactly the toolbar's height.
      className="relative flex min-h-0 flex-1 flex-col touch-none overflow-hidden outline-none select-none"
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
        {/* One continuous rule between the heads and the tracks, never a border
            per row — see Timeline.md. */}
        {hasMedia && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: 'calc(var(--timeline-head-width) - 1px)' }}
          />
        )}
        {/* Ruler. **Removed from the tree, never `hidden`**: Tailwind's
            Preflight writes that rule through `:where()`, so any display
            utility on the element outranks it. See Timeline.md. */}
        {hasMedia && (
          <div
            className="flex border-b border-border"
            style={{ height: 'var(--timeline-ruler-height)' }}
          >
            <div className="shrink-0" style={{ width: 'var(--timeline-head-width)' }} />
            {/* contentRef is the window, not the strip. */}
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

        <div className="flex min-h-0 flex-1 flex-col justify-center">
          {/* Nothing laid down yet. The placeholder is shaped like the track it
              is about to become, so dropping does not make the strip jump —
              see Timeline.md. */}
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

          {/* Subtitles. The lane only exists once there are any — see
              Timeline.md. */}
          <TimelineTrack
            icon={<Type size={13} />}
            label="Subtitles"
            hidden={!hasMedia || utterances.length === 0}
            contentWidth={contentWidth}
            offsetPx={offsetPx}
            contentRef={subtitleRowRef}
          >
            {blocks.map((block) => {
              const selected = selectedUtteranceIds.includes(block.id)
              // Never wider than half the block, so the two ends cannot overlap
              // however narrow it gets. There is deliberately no width below
              // which the ends stop existing — see Timeline.md.
              const hitPx = Math.min(TRIM_HIT_PX, block.widthPx / 2)
              const outsetPx = Math.min(TRIM_BAR_PX, hitPx / 2)
              return (
                <div
                  key={block.id}
                  data-subtitle-block
                  data-subtitle-ids={block.id}
                  // Lifted while selected: the plate reaches past both ends,
                  // and a line starting where this one finishes is a later
                  // sibling that would paint straight over that edge.
                  className={`absolute inset-y-adjust ${selected ? 'z-10' : ''}`}
                  style={{ left: block.leftPx, width: block.widthPx }}
                >
                  {/* **One plate behind the line, not an outline plus two
                      bars** — three rectangles cannot be made to meet cleanly
                      at the corners. See Timeline.md. */}
                  {selected && (
                    <div
                      className="pointer-events-none absolute rounded-sm bg-foreground"
                      style={{
                        left: -TRIM_BAR_PX,
                        right: -TRIM_BAR_PX,
                        top: -SELECTION_EDGE_PX,
                        bottom: -SELECTION_EDGE_PX
                      }}
                    />
                  )}

                  <div
                    className="absolute inset-0 flex items-center rounded-xs"
                    // The body has to be opaque or the white plate behind it
                    // washes the colour out: --editor-waveform is only 55%
                    // opaque, so the panel surface is laid under it here. Not a
                    // stacking problem — see Timeline.md.
                    style={{
                      backgroundColor: 'var(--card)',
                      backgroundImage:
                        'linear-gradient(var(--editor-waveform), var(--editor-waveform))'
                    }}
                  >
                    {/* `min-w-0` is what gives truncation an edge to work at: a
                        flex item will not shrink below its content, so without
                        it the text overflows the block whole and is cut off
                        rather than ellipsised. */}
                    {block.text !== '' && block.widthPx >= MIN_CAPTION_PX && (
                      <span className="pointer-events-none min-w-0 flex-1 truncate px-inline text-caption leading-[var(--timeline-subtitle-height)] text-white">
                        {block.text}
                      </span>
                    )}
                  </div>

                  {/* The drag targets. They draw nothing — the plate already
                      shows where the ends are (see Timeline.md). */}
                  {selected &&
                    (['start', 'end'] as const).map((edge) => (
                      <div
                        key={edge}
                        data-trim-edge={edge}
                        data-trim-id={block.id}
                        // Straddles the edge so the target is worth aiming at
                        // from either side of it.
                        className="absolute inset-y-0 cursor-ew-resize"
                        style={{
                          width: hitPx,
                          [edge === 'start' ? 'left' : 'right']: -outsetPx
                        }}
                      />
                    ))}
                </div>
              )
            })}
          </TimelineTrack>

          {/* Main track: three bands of fixed token height, so the clip needs
              no internal flex — see Timeline.md. */}
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

                <div
                  className="relative shrink-0 overflow-hidden"
                  style={{ height: 'var(--timeline-media-wave-height)' }}
                >
                  {clip.peaks !== null &&
                    (() => {
                      // The same visible-span arithmetic as the filmstrip above.
                      const clipLeftPx = contentWidth * (clip.startMs / durationMs)
                      return (
                        <Waveform
                          peaks={clip.peaks}
                          clipWidthPx={contentWidth * (clip.durationMs / durationMs)}
                          fromPx={offsetPx - clipLeftPx}
                          toPx={offsetPx + width - clipLeftPx}
                        />
                      )
                    })()}
                </div>

                {/* **A sibling layer with a z-index, not a border or an outline
                    on the clip.** Both of those lose to the clip's own
                    positioned children — see Timeline.md. */}
                {selectedClipIds.includes(clip.id) && (
                  <div className="pointer-events-none absolute inset-0 z-10 rounded-xs border border-foreground" />
                )}
              </div>
            ))}
          </TimelineTrack>
        </div>

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

        {/* Playhead spans every track, offset past the heads. **It needs a
            window of its own**: once the view is scrolled its translate goes
            negative and it would be drawn across the track heads. */}
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
              {/* The grip in the ruler (see Timeline.md). The clip-path
                  shoulder is the bar token rather than a percentage, so
                  changing either height leaves the other alone. */}
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

      {/* Horizontal scrollbar, drawn rather than delegated to `overflow-x`.
          Its look is the template every scrollbar in the app follows, so
          changing the colours here means changing the global rule too — see
          Timeline.md and styles.md. */}
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
              // Capped: the strip is shorter than the window whenever the view
              // is zoomed out or the window was widened, and the thumb would
              // otherwise overrun the bar.
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
