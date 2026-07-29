import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { MediaAssetSummary, TimelineClipSummary } from '../../../shared/ipc'

export interface TimelinePlayback {
  /** The clip the element is loaded with, or null when the timeline is empty. */
  clip: TimelineClipSummary | null
  /** Media URL for that clip; '' keeps the element from loading anything. */
  src: string
  /** Sum of every clip's duration — the length of the whole timeline. */
  durationMs: number
  /** Jump the timeline to this position, switching clips when it crosses one. */
  seek(timelineMs: number): void
  /** Element time → timeline time. */
  toTimelineMs(elementMs: number): number
  /** Roll onto the next clip; call when the element reports `ended`. */
  advance(): void
}

/** Plays a list of clips through one `<video>` element, whose `src` is swapped
 *  at each boundary. **Timeline time is the only currency crossing this
 *  boundary** — element time restarts at zero on every clip, and callers never
 *  see it (see useTimelinePlayback.md). */
export function useTimelinePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  clips: TimelineClipSummary[],
  assets: MediaAssetSummary[]
): TimelinePlayback {
  const [clipId, setClipId] = useState<string | null>(null)
  /** Where to land once the newly loaded file reports its metadata. */
  const pendingSeekRef = useRef<number | null>(null)
  /** Whether the swap interrupted playback and should resume it. */
  const resumeRef = useRef(false)

  const last = clips[clips.length - 1]
  const durationMs = last ? last.startMs + last.durationMs : 0

  // The list changes under us — a clip is deleted, an asset goes missing — so
  // the loaded clip is resolved by id every render rather than stored.
  const clip = clips.find((candidate) => candidate.id === clipId) ?? clips[0] ?? null
  const asset = clip ? (assets.find((candidate) => candidate.id === clip.assetId) ?? null) : null
  const src = asset && !asset.missing ? asset.mediaUrl : ''

  // Deleting the loaded clip leaves clipId dangling; adopting whatever the
  // fallback resolved to keeps the next seek from thinking nothing changed.
  useEffect(() => {
    if (clip && clip.id !== clipId) setClipId(clip.id)
  }, [clip, clipId])

  /** The clip covering `timelineMs`, clamped to the ends. */
  const clipAt = useCallback(
    (timelineMs: number): TimelineClipSummary | null => {
      if (clips.length === 0) return null
      for (const candidate of clips) {
        if (timelineMs < candidate.startMs + candidate.durationMs) return candidate
      }
      return clips[clips.length - 1] ?? null
    },
    [clips]
  )

  const seek = useCallback(
    (timelineMs: number): void => {
      const video = videoRef.current
      const target = clipAt(timelineMs)
      if (!video || !target) return
      const elementMs = Math.max(0, timelineMs - target.startMs)

      if (target.id === clipId) {
        video.currentTime = elementMs / 1000
        return
      }
      // Switching files: the element cannot be seeked until the new one has
      // metadata, so the position is parked and applied by onLoadedMetadata.
      pendingSeekRef.current = elementMs
      resumeRef.current = !video.paused
      setClipId(target.id)
    },
    [clipAt, clipId, videoRef]
  )

  const toTimelineMs = useCallback(
    (elementMs: number): number => (clip?.startMs ?? 0) + elementMs,
    [clip]
  )

  /** Runs on the element's `ended`: play on into the next clip, or stop. */
  const advance = useCallback((): void => {
    if (!clip) return
    const index = clips.findIndex((candidate) => candidate.id === clip.id)
    const next = clips[index + 1]
    if (!next) return
    pendingSeekRef.current = 0
    resumeRef.current = true
    setClipId(next.id)
  }, [clip, clips])

  // Applying the parked seek is the whole point of listening for metadata:
  // currentTime set before this fires is silently discarded.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onLoaded = (): void => {
      const pending = pendingSeekRef.current
      pendingSeekRef.current = null
      if (pending !== null) video.currentTime = pending / 1000
      if (resumeRef.current) {
        resumeRef.current = false
        void video.play()
      }
    }
    video.addEventListener('loadedmetadata', onLoaded)
    return () => video.removeEventListener('loadedmetadata', onLoaded)
  }, [videoRef])

  return { clip, src, durationMs, seek, toTimelineMs, advance }
}
