import { useCallback, useEffect, useState } from 'react'

interface UseRecentFontsResult {
  /** Newest first; empty until a font has been picked, and while loading. */
  recent: string[]
  /** Report a pick. The stored list comes back from the main process, so the
   *  order and the limit are never computed twice (see main/settings.md). */
  remember(value: string): void
}

export function useRecentFonts(): UseRecentFontsResult {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void window.logcut.getRecentFonts().then((stored) => {
      if (!cancelled) setRecent(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const remember = useCallback((value: string): void => {
    // Laid over the screen before the round trip finishes, so the group the
    // picked font belongs to is already right when the list reopens.
    setRecent((current) => [value, ...current.filter((font) => font !== value)])
    void window.logcut.rememberFont(value).then(setRecent)
  }, [])

  return { recent, remember }
}
