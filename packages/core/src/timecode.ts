/** Timecodes, both directions. **The parser lives beside the formatters because
 *  they have to agree** — any disagreement silently moves subtitles. */

/** mm:ss below an hour, h:mm:ss above it. What a reader wants to see. */
export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/**
 * Every field, every time: `HH:MM:SS.mm`. Both properties that matter come
 * from it being fixed width:
 *
 * - **it round-trips.** `formatTimecode` drops the fraction, so a line at
 *   08:25.400 shows as `08:25`; typing that back moves it 400ms — invisible in
 *   the UI, plain on the subtitle. Anything editable must show what it holds.
 * - **the digits do not move.** A column of times that gains and loses its
 *   hour field cannot be read down, and the field under the caret would shift
 *   as the value crossed an hour.
 *
 * Hundredths rather than milliseconds: see timecode.md.
 */
export function formatTimecodeFull(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  const totalSeconds = Math.floor(clamped / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const hundredths = String(Math.floor((clamped % 1000) / 10)).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}.${hundredths}`
}

/**
 * Read `ss` / `mm:ss` / `h:mm:ss`, each optionally with `.mmm`. **Null for
 * anything else**, which callers treat as "leave the value alone" — a typo
 * must never be read as a time.
 *
 * A short fraction is padded, not zero-filled from the left: `.4` is 400ms.
 */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+(:\d{1,2})*(\.\d{1,3})?$/.test(trimmed)) return null

  const [clock = '', fraction = ''] = trimmed.split('.')
  const parts = clock.split(':')
  if (parts.length > 3) return null

  // Rightmost field is always seconds, however many were typed.
  const [seconds = 0, minutes = 0, hours = 0] = parts.map(Number).reverse()
  if (parts.length > 1 && seconds > 59) return null
  if (parts.length > 2 && minutes > 59) return null

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction.padEnd(3, '0'))
}
