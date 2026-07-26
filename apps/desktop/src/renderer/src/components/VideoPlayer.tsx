import { forwardRef } from 'react'
import type { JSX } from 'react'

interface VideoPlayerProps {
  src: string
  onTimeUpdate(currentTimeMs: number): void
  /** Text of the utterance playing now; null or empty renders no caption. */
  captionText: string | null
}

/**
 * The video sits centred in whatever space the pane gives it, letterboxed by
 * the panel surface on the short axis.
 *
 * Captions have no toggle: they show whenever the active asset has a
 * transcript, and there is nothing to show when it does not. A switch would
 * only ever be turned off to see a frame unobstructed, which the caption's
 * placement already allows.
 */
const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  { src, onTimeUpdate, captionText },
  ref
) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center bg-black">
      <video
        ref={ref}
        className="max-h-full max-w-full"
        src={src}
        controls
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime * 1000)}
      />
      {captionText && (
        // bottom-14 keeps the caption clear of the native <video controls> bar.
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-inset">
          <span className="max-w-[90%] rounded-panel bg-black/60 px-stack py-inline text-center text-body-lg leading-snug text-white [text-wrap:balance]">
            {captionText}
          </span>
        </div>
      )}
    </div>
  )
})

export default VideoPlayer
