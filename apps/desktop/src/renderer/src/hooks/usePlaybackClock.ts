import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Drives the playhead at frame rate without going through React.
 *
 * `timeupdate` only fires about four times a second — enough to highlight the
 * current subtitle, far too coarse for a marker sliding across the timeline.
 * The callback here runs inside requestAnimationFrame while playing and is
 * expected to write to the DOM directly; routing it through state would mean a
 * re-render every frame.
 */
export function usePlaybackClock(
  videoRef: RefObject<HTMLVideoElement | null>,
  onTick: (timeMs: number) => void,
  /**
   * Anything that changes when the element itself appears or is replaced.
   *
   * A ref object never changes identity, so an effect that depends on the ref
   * alone runs exactly once — and at that moment there may be no element at
   * all. The editor mounts before its project loads, so there are no clips, no
   * `src`, and no `<video>`; the effect returned early and never ran again,
   * which left the playhead deaf to every seek and to playback itself. It only
   * appeared to work because dragging on the timeline writes it directly.
   */
  mounted: unknown
): void {
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let frame = 0
    const emit = (): void => onTickRef.current(video.currentTime * 1000)

    const loop = (): void => {
      emit()
      frame = requestAnimationFrame(loop)
    }
    const start = (): void => {
      if (frame === 0) frame = requestAnimationFrame(loop)
    }
    const stop = (): void => {
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      // One last write so the playhead lands exactly where playback stopped.
      emit()
    }

    video.addEventListener('play', start)
    video.addEventListener('playing', start)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    // Seeking and metadata arrive while paused, and both move the playhead.
    video.addEventListener('seeked', emit)
    video.addEventListener('loadedmetadata', emit)

    if (!video.paused) start()
    else emit()

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      video.removeEventListener('play', start)
      video.removeEventListener('playing', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
      video.removeEventListener('seeked', emit)
      video.removeEventListener('loadedmetadata', emit)
    }
  }, [videoRef, mounted])
}
