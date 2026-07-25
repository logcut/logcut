import type { Utterance } from './types.ts'

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/** SRT timestamp: HH:MM:SS,mmm (comma before milliseconds). */
export function formatSrtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`
}

/**
 * Serialize utterances to SRT. CRLF line endings for best compatibility with
 * Windows players; blocks are 1-indexed and separated by a blank line.
 */
export function toSrt(utterances: Utterance[]): string {
  return (
    utterances
      .map(
        (utterance, index) =>
          `${index + 1}\r\n` +
          `${formatSrtTimestamp(utterance.start)} --> ${formatSrtTimestamp(utterance.end)}\r\n` +
          `${utterance.text}\r\n`
      )
      .join('\r\n') + '\r\n'
  )
}
