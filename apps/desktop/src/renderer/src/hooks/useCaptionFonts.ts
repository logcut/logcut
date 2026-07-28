import { useEffect, useState } from 'react'
import { FALLBACK_CAPTION_FONTS, loadCaptionFonts, type CaptionFont } from '@/lib/caption-fonts'

/**
 * The fonts the caption picker offers.
 *
 * Read once per session and shared through a module-level promise: enumerating
 * installed fonts is a system call returning hundreds of faces, and the answer
 * cannot change while the app is running. Without this, every mount of the
 * subtitle column would pay for it again.
 *
 * Starts on the bundled list rather than on nothing, so the picker is never
 * momentarily empty and the value already chosen always has a row to sit on.
 */
let pending: Promise<CaptionFont[]> | null = null

function fonts(): Promise<CaptionFont[]> {
  pending ??= loadCaptionFonts()
  return pending
}

export function useCaptionFonts(): CaptionFont[] {
  const [available, setAvailable] = useState<CaptionFont[]>(FALLBACK_CAPTION_FONTS)

  useEffect(() => {
    let cancelled = false
    void fonts().then((loaded) => {
      if (!cancelled) setAvailable(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
