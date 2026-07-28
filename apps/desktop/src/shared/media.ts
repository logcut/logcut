/** Importable media extensions. Shared so the drop target, the picker filter
 *  and the main-process validation cannot drift apart. Audio is deliberately
 *  absent — see media.md. */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'] as const

/** Frames in a clip's filmstrip. **Both sides need the same number and
 *  neither owns it**: main tiles exactly this many into one sheet, and the
 *  renderer divides the sheet by it to address a single frame. */
export const FILMSTRIP_FRAMES = 40

export function isSupportedMediaFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
