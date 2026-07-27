/**
 * Timecodes, both directions.
 *
 * The parser lives beside the formatters because they have to agree: the
 * subtitle list writes a time out for the user to edit and reads back whatever
 * comes home, and any disagreement between the two silently moves subtitles.
 */

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
 * Every field, every time: `HH:MM:SS.mm`, hundredths of a second at the end.
 *
 * Two properties matter, and both come from it being fixed width:
 *
 *  - **it round-trips.** `formatTimecode` drops the fraction, so a line that
 *    began at 08:25.400 shows as `08:25`; type that straight back and it has
 *    moved four hundred milliseconds — plainly visible on a subtitle, entirely
 *    invisible in the UI. Anything editable has to show what it holds.
 *  - **the digits do not move.** A list of times that gains and loses its hour
 *    field cannot be read down a column, and the field under the caret would
 *    shift as the value crossed an hour.
 *
 * Hundredths rather than milliseconds is a deliberate trade: the last digit of
 * a millisecond is a third of the way into a frame, so it is noise the user
 * would have to type. Times are quantised to 10ms when one is committed.
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
 * Read `ss` / `mm:ss` / `h:mm:ss`, each optionally with `.mmm`. Returns null
 * for anything else, which callers treat as "leave the value alone" — a typo
 * must never be interpreted as a time.
 *
 * A short fraction is padded, not zero-filled from the left: `.4` is four
 * hundred milliseconds, the way a decimal reads everywhere else.
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
