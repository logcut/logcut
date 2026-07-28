import { useEffect, useState } from 'react'
import { FALLBACK_CAPTION_FONTS, loadCaptionFonts, type CaptionFont } from '@/lib/caption-fonts'

/**
 * The fonts the caption picker offers.
 *
 * **Read once per session, shared through a module-level promise.**
 * Enumerating installed fonts is a system call returning hundreds of faces
 * and cannot change while the app runs; without this every mount of the
 * subtitle column pays for it again.
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
