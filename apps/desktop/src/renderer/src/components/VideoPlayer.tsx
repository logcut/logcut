import { Captions } from 'lucide-react'
import { forwardRef } from 'react'
import { Button } from '@/components/ui/button'

interface VideoPlayerProps {
  src: string
  onTimeUpdate(currentTimeMs: number): void
  /** Text of the utterance playing now; null or empty renders no caption. */
  captionText: string | null
  captionsOn: boolean
  onToggleCaptions(): void
}

const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  { src, onTimeUpdate, captionText, captionsOn, onToggleCaptions },
  ref
) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative bg-black">
        <video
          ref={ref}
          className="max-h-[70vh] w-full bg-black"
          src={src}
          controls
          onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime * 1000)}
        />
        {captionsOn && captionText && (
          // bottom-14 keeps the caption clear of the native <video controls> bar.
          <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-4">
            <span className="max-w-[90%] rounded bg-black/60 px-3 py-1 text-center text-lg leading-snug text-white [text-wrap:balance]">
              {captionText}
            </span>
          </div>
        )}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3">
        <Button
          variant={captionsOn ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onToggleCaptions}
          title={captionsOn ? 'Hide captions' : 'Show captions'}
        >
          <Captions size={16} />
          Captions {captionsOn ? 'On' : 'Off'}
        </Button>
      </div>
    </div>
  )
})

export default VideoPlayer
