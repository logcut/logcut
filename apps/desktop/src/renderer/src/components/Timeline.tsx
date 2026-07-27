import { findNearestUtteranceIndex } from '@logcut/core'
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
  missing: boolean
}

interface TimelineProps {
  durationMs: number
  clips: TimelineClipView[]
  /** Already on the timeline's clock — see lib/timeline.ts layUtterances. */
  utterances: Utterance[]
  activeUtteranceId: string | null
  selectedClipId: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  onSelectClip(clipId: string | null): void
  onRemoveClip(clipId: string): void
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
  /** An asset was dragged here from the media library. */
  onDropAsset(assetId: string): void
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
  hidden,
  children
}: {
  icon: JSX.Element
  label: string
  main?: boolean
  hidden?: boolean
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
  clips,
  selectedClipId,
  videoRef,
  onSelectClip,
  onRemoveClip,
  onScrub,
  onSeek,
  clipOffsetMs,
  onDropAsset,
  onEditSubtitlesAt
}: TimelineProps): JSX.Element {
  const [dropTarget, setDropTarget] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  /** The area clips occupy, i.e. everything right of the track heads. All
   *  time↔pixel conversion is against this, never the whole container. */
  const contentRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const lastPressRef = useRef(0)
  /** Latest scrub target, and the frame that will hand it to the element. */
  const pendingSeekRef = useRef<number | null>(null)
  const seekFrameRef = useRef(0)
  const [width, setWidth] = useState(0)
  const hasMedia = durationMs > 0

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

  // Through a ref so the tick callback stays stable across clip switches.
  const clipOffsetRef = useRef(clipOffsetMs)
  clipOffsetRef.current = clipOffsetMs
  const onTick = useCallback(
    (elementMs: number) => movePlayhead(clipOffsetRef.current + elementMs),
    [movePlayhead]
  )
  usePlaybackClock(videoRef, onTick)

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
    onSelectClip(element?.getAttribute('data-clip-id') ?? null)

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
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (selectedClipId === null) return
    event.preventDefault()
    onRemoveClip(selectedClipId)
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
        >
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

        {/* Main track: a caption bar, the filmstrip, then the audio envelope.
            The three band heights are tokens and sum to the track height, so
            the clip has no internal flex — each band is exactly its own
            height whatever the panel is doing. */}
        <TimelineTrack icon={<Film size={13} />} label="Video" main hidden={!hasMedia}>
          {clips.map((clip) => (
            <div
              key={clip.id}
              data-clip-id={clip.id}
              className={`absolute inset-y-0 flex flex-col overflow-hidden rounded-xs ${
                clip.id === selectedClipId ? 'ring-2 ring-foreground ring-inset' : ''
              }`}
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

              {/* Stretched to the band rather than covered: the strip holds
                  exactly the whole clip, so any cropping would silently drop
                  the end of it. */}
              <div
                className="shrink-0 bg-cover"
                style={{
                  height: 'var(--timeline-media-strip-height)',
                  backgroundImage: clip.filmstripUrl ? `url("${clip.filmstripUrl}")` : undefined,
                  backgroundSize: '100% 100%'
                }}
              />

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
            </div>
          ))}
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
    </div>
  )
}
