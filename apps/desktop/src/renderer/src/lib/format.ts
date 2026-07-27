import { formatTimecode } from '@logcut/core'

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
