/**
 * Timecode for playback positions and durations: mm:ss below an hour, h:mm:ss
 * above it. Shared by the subtitle list, the timeline ruler and project cards
 * so the same instant never reads two different ways.
 */
export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/** Durations are unknown (0) when probing failed; say so rather than "00:00". */
export function formatDuration(ms: number): string {
  return ms > 0 ? formatTimecode(ms) : '--:--'
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days <= 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(timestamp).toLocaleDateString()
}

/** Strips Electron's IPC wrapper so the user sees the message main threw. */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function errorMessageOf(error: unknown): string {
  return stripIpcErrorPrefix(error instanceof Error ? error.message : String(error))
}
