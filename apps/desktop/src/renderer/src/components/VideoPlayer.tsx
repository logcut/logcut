import { formatTimecode } from '@logcut/core'
import { Maximize, Minimize, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
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
export default function VideoPlayer({
  videoRef,
  src,
  clipOffsetMs,
  durationMs,
  onTimeUpdate,
  onEnded,
  captionText
}: VideoPlayerProps): JSX.Element {
  /** Fullscreen takes the controls with the picture, so it is the whole pane. */
  const paneRef = useRef<HTMLDivElement>(null)
  const [elementMs, setElementMs] = useState(0)
  const [paused, setPaused] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  /** The picture's size on screen — the letterbox around it is not it. */
  const [frame, setFrame] = useState({ width: 0, height: 0 })

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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Sized to the picture, so the caption sits inside the frame
                wherever the letterbox happens to leave it. */}
            <div
              className="flex items-end justify-center px-inset pb-block"
              style={{ width: frame.width, height: frame.height }}
            >
              <span className="max-w-full rounded-panel bg-black/60 px-stack py-inline text-center text-body-lg leading-snug text-white [text-wrap:balance]">
                {captionText}
              </span>
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
