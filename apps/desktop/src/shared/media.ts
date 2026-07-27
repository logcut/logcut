/**
 * Importable media extensions. Shared so the drop target, the native picker
 * filter, and the main-process validation cannot drift apart.
 *
 * Audio is deliberately absent: MediaKind allows it, but nothing downstream
 * handles an asset without a video stream yet.
 */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'] as const

/**
 * Frames in a clip's filmstrip.
 *
 * Shared because both sides need the same number and neither owns it: main
 * tiles exactly this many into one sheet, and the renderer has to know how the
 * sheet is divided to address a single frame in it.
 */
export const FILMSTRIP_FRAMES = 40

export function isSupportedMediaFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
