import { findNearestUtteranceIndex } from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { Film, Type } from 'lucide-react'
import { usePlaybackClock } from '@/hooks/usePlaybackClock'
import { formatTimecode } from '@/lib/format'
import { mergeBlocks, pickTickInterval, pxPerMs, tickTimes } from '@/lib/timeline'

/**
 * The macOS default sits near 500ms and its slider reaches far slower still,
 * so 400 was under the platform default: an unhurried double-click registered
 * as two separate seeks and the editor never opened.
 */
const DOUBLE_CLICK_MS = 600

/**
 * Fit-to-width makes a short line a fraction of a pixel wide. Blocks are
 * widened to this so every subtitle stays visible and aimable; nothing is
 * being edited on the timeline, so the drift it introduces costs nothing.
 */
const MIN_BLOCK_PX = 4

interface TimelineProps {
  durationMs: number
  utterances: Utterance[]
  activeUtteranceId: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  assetName: string | null
  /** Row of frames for the media track; null until generated. */
  filmstripUrl: string | null
  /** White-on-transparent envelope, tinted here; null until generated. */
  waveformUrl: string | null
  /** Double-click on a subtitle block, with the time that was clicked. */
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
  children
}: {
  icon: JSX.Element
  label: string
  main?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="flex"
      style={{
        height: main ? 'var(--timeline-media-height)' : 'var(--timeline-subtitle-height)'
      }}
    >
      <div
        className="flex shrink-0 items-center gap-inline border-r border-border px-component text-muted-foreground"
        style={{ width: 'var(--timeline-head-width)' }}
        title={label}
      >
        {icon}
      </div>
      <div className="relative min-w-0 flex-1 py-adjust">{children}</div>
    </div>
  )
}

export default function Timeline({
  durationMs,
  utterances,
  activeUtteranceId,
  videoRef,
  assetName,
  filmstripUrl,
  waveformUrl,
  onEditSubtitlesAt
}: TimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  /** The area clips occupy, i.e. everything right of the track heads. All
   *  time↔pixel conversion is against this, never the whole container. */
  const contentRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const lastPressRef = useRef(0)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const scale = pxPerMs(width, durationMs)

  // Written straight to the DOM: this runs every animation frame during
  // playback and must not re-render the tree.
  const movePlayhead = useCallback((timeMs: number) => {
    const playhead = playheadRef.current
    const content = contentRef.current
    if (!playhead || !content) return
    const total = Number(content.dataset.durationMs)
    if (!(total > 0)) return
    const ratio = Math.max(0, Math.min(1, timeMs / total))
    playhead.style.transform = `translateX(${ratio * content.clientWidth}px)`
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
    const content = contentRef.current
    if (!content || durationMs <= 0) return 0
    const rect = content.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(1, ratio)) * durationMs
  }

  const seekTo = (timeMs: number): void => {
    const video = videoRef.current
    if (!video) return
    // Move the marker immediately: seeking a large file has visible latency,
    // and a playhead that lags the pointer feels broken.
    movePlayhead(timeMs)
    video.currentTime = timeMs / 1000
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (durationMs <= 0) return
    // Track heads are left of the scale. Without this, pressing one converts
    // to a negative time, clamps to zero and jumps playback to the start.
    const content = contentRef.current
    if (content && event.clientX < content.getBoundingClientRect().left) return

    const timeMs = pressTimeOf(event)
    seekTo(timeMs)

    // Double-click is detected by hand rather than with onDoubleClick, for two
    // reasons: capturing the pointer to scrub retargets every later click at
    // the capturing element, so a handler on an inner track never fires; and
    // PointerEvent.detail is always 0, unlike MouseEvent's click count.
    const isSecondClick = event.timeStamp - lastPressRef.current < DOUBLE_CLICK_MS
    lastPressRef.current = isSecondClick ? 0 : event.timeStamp
    if (isSecondClick && utterances.length > 0) {
      onEditSubtitlesAt(timeMs)
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  // Dragging never snaps: scrubbing has to follow the pointer exactly.
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    seekTo(timeAtClientX(event.clientX))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col touch-none overflow-hidden select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Ruler. Its left spacer keeps the scale aligned with the tracks below. */}
      <div
        className="flex border-b border-border"
        style={{ height: 'var(--timeline-ruler-height)' }}
      >
        <div
          className="shrink-0 border-r border-border"
          style={{ width: 'var(--timeline-head-width)' }}
        />
        <div ref={contentRef} data-duration-ms={durationMs} className="relative min-w-0 flex-1">
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

      {/* Tracks sit centred in whatever height is left, so growing the panel
          pads above and below rather than leaving them stranded at the top. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        {/* Secondary track: subtitles. One block per line, adjacent ones merged. */}
        <TimelineTrack icon={<Type size={13} />} label="Subtitles">
          {blocks.map((block) => (
            <div
              key={block.startMs}
              data-subtitle-block
              className="absolute inset-y-adjust rounded-xs"
              style={{
                left: `${(block.startMs / durationMs) * 100}%`,
                width: `${((block.endMs - block.startMs) / durationMs) * 100}%`,
                minWidth: MIN_BLOCK_PX,
                background: block.active ? 'var(--editor-selection)' : 'var(--editor-waveform)'
              }}
            />
          ))}
        </TimelineTrack>

        {/* Main track: the asset itself, filmstrip over waveform. */}
        <TimelineTrack icon={<Film size={13} />} label="Video" main>
          {assetName !== null && durationMs > 0 && (
            <div
              className="absolute inset-0 flex flex-col overflow-hidden rounded-xs"
              style={{ background: 'var(--editor-waveform-muted)' }}
            >
              <div
                className="min-h-0 flex-1 bg-cover"
                style={filmstripUrl ? { backgroundImage: `url("${filmstripUrl}")` } : undefined}
              />
              {waveformUrl && (
                // The PNG is white on transparent; masking lets it take the
                // theme's waveform colour instead of shipping one per theme.
                <div
                  className="h-1/3 shrink-0"
                  style={{
                    background: 'var(--editor-waveform)',
                    maskImage: `url("${waveformUrl}")`,
                    maskSize: '100% 100%',
                    WebkitMaskImage: `url("${waveformUrl}")`,
                    WebkitMaskSize: '100% 100%'
                  }}
                />
              )}
              <span className="absolute top-adjust left-inline truncate text-caption font-normal text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                {assetName}
              </span>
            </div>
          )}
        </TimelineTrack>
      </div>

      {/* Playhead spans every track, offset past the heads. */}
      {durationMs > 0 && (
        <div
          ref={playheadRef}
          className="pointer-events-none absolute top-0 bottom-0 w-px"
          style={{ left: 'var(--timeline-head-width)', background: 'var(--editor-playhead)' }}
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
