import type { Utterance } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { usePlaybackClock } from '@/hooks/usePlaybackClock'
import { formatTimecode } from '@/lib/format'
import { mergeBlocks, pickTickInterval, pxPerMs, tickTimes } from '@/lib/timeline'

/** Matches the platform default closely enough for a scrub-or-edit decision. */
const DOUBLE_CLICK_MS = 400

/** The editor opens split 60/40 between the panes above and the timeline. */
const DEFAULT_HEIGHT_RATIO = 0.4
const MAX_HEIGHT_RATIO = 0.75
const MIN_HEIGHT = 96
/** EditorTopBar is h-12; everything below it is what the split divides. */
const TOP_BAR_HEIGHT = 48

function availableHeight(): number {
  return Math.max(0, window.innerHeight - TOP_BAR_HEIGHT)
}

function defaultHeight(): number {
  return Math.max(MIN_HEIGHT, Math.round(availableHeight() * DEFAULT_HEIGHT_RATIO))
}

/** Recomputed on every drag rather than cached, so resizing the window
 *  does not leave the limit stuck at an old value. */
function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.round(availableHeight() * MAX_HEIGHT_RATIO))
}

interface TimelineProps {
  durationMs: number
  utterances: Utterance[]
  activeUtteranceId: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  assetName: string | null
  /** Double-click on a subtitle block, with the time that was clicked. */
  onEditSubtitlesAt(timeMs: number): void
}

export default function Timeline({
  durationMs,
  utterances,
  activeUtteranceId,
  videoRef,
  assetName,
  onEditSubtitlesAt
}: TimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const lastPressRef = useRef(0)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(defaultHeight)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const scale = pxPerMs(width, durationMs)

  // Written straight to the DOM: this runs every animation frame during
  // playback and must not re-render the tree.
  const movePlayhead = useCallback((timeMs: number) => {
    const playhead = playheadRef.current
    const container = containerRef.current
    if (!playhead || !container) return
    const total = Number(container.dataset.durationMs)
    if (!(total > 0)) return
    const ratio = Math.max(0, Math.min(1, timeMs / total))
    playhead.style.transform = `translateX(${ratio * container.clientWidth}px)`
  }, [])

  usePlaybackClock(videoRef, movePlayhead)

  const ticks = useMemo(() => {
    if (scale <= 0) return []
    return tickTimes(durationMs, pickTickInterval(scale))
  }, [durationMs, scale])

  const blocks = useMemo(
    () => (scale > 0 ? mergeBlocks(utterances, scale, activeUtteranceId) : []),
    [utterances, scale, activeUtteranceId]
  )

  const timeAtClientX = (clientX: number): number => {
    const container = containerRef.current
    if (!container || durationMs <= 0) return 0
    const rect = container.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(1, ratio)) * durationMs
  }

  const seekTo = (clientX: number): void => {
    const video = videoRef.current
    if (!video) return
    const timeMs = timeAtClientX(clientX)
    // Move the marker immediately: seeking a large file has visible latency,
    // and a playhead that lags the pointer feels broken.
    movePlayhead(timeMs)
    video.currentTime = timeMs / 1000
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (durationMs <= 0) return
    seekTo(event.clientX)

    // Double-click is detected by hand rather than with onDoubleClick, for two
    // reasons: capturing the pointer to scrub retargets every later click at
    // the capturing element, so a handler on an inner track never fires; and
    // PointerEvent.detail is always 0, unlike MouseEvent's click count.
    const isSecondClick = event.timeStamp - lastPressRef.current < DOUBLE_CLICK_MS
    lastPressRef.current = isSecondClick ? 0 : event.timeStamp
    if (isSecondClick && utterances.length > 0) {
      onEditSubtitlesAt(timeAtClientX(event.clientX))
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    seekTo(event.clientX)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // The grip sits inside the timeline, so every handler here has to stop
  // propagation: otherwise dragging it would also scrub.
  const handleResizeDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = { startY: event.clientY, startHeight: height }
  }

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current
    if (!resize) return
    event.stopPropagation()
    // Dragging up grows the timeline, so the delta is inverted.
    const next = resize.startHeight + (resize.startY - event.clientY)
    setHeight(Math.min(Math.max(next, MIN_HEIGHT), maxHeight()))
  }

  const handleResizeUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={containerRef}
      data-duration-ms={durationMs}
      className="relative shrink-0 touch-none overflow-hidden border-t border-border bg-card select-none"
      style={{ height: `${height}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Resize grip, overlapping the top border. */}
      <div
        className="absolute inset-x-0 top-0 z-10 h-adjust cursor-ns-resize hover:bg-accent/40"
        title="Drag to resize the timeline"
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
        onPointerCancel={handleResizeUp}
      />

      {/* Ruler */}
      <div
        className="relative border-b border-border"
        style={{ height: 'var(--timeline-ruler-height)' }}
      >
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

      {/* Subtitle track */}
      <div className="relative" style={{ height: 'var(--timeline-subtitle-height)' }}>
        {blocks.map((block) => (
          <div
            key={block.startMs}
            className="absolute top-inline bottom-inline rounded-xs"
            style={{
              left: `${(block.startMs / durationMs) * 100}%`,
              width: `${Math.max(((block.endMs - block.startMs) / durationMs) * 100, 0.1)}%`,
              background: block.active ? 'var(--editor-selection)' : 'var(--editor-waveform)'
            }}
          />
        ))}
      </div>

      {/* Media track */}
      <div className="relative" style={{ height: 'var(--timeline-media-height)' }}>
        {assetName !== null && durationMs > 0 && (
          <div
            className="absolute inset-x-0 top-inline bottom-inline flex items-center gap-inline overflow-hidden rounded-xs px-component"
            style={{ background: 'var(--editor-waveform-muted)' }}
          >
            <span className="truncate text-caption font-normal text-foreground">{assetName}</span>
          </div>
        )}
      </div>

      {/* Playhead spans every track. */}
      {durationMs > 0 && (
        <div
          ref={playheadRef}
          className="pointer-events-none absolute top-0 bottom-0 left-0 w-px"
          style={{ background: 'var(--editor-playhead)' }}
        />
      )}

      {durationMs <= 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-caption font-normal text-muted-foreground">
            Import a video to see its timeline.
          </span>
        </div>
      )}
    </div>
  )
}
