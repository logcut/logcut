/**
 * Importable media extensions. Shared so the drop target, the native picker
 * filter, and the main-process validation cannot drift apart.
 *
 * Audio is deliberately absent: MediaKind allows it, but nothing downstream
 * handles an asset without a video stream yet.
 */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'] as const

export function isSupportedMediaFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
