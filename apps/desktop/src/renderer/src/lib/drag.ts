import { isSupportedMediaFile } from '../../../shared/media'

/**
 * The drag type that moves an asset from the media library onto the timeline.
 *
 * A custom type rather than 'text/plain' so the timeline can tell an asset
 * apart from any other drag — a file dragged in from Finder, or selected text
 * — with dataTransfer.types alone, which is all the dragover event is allowed
 * to see.
 */
export const MEDIA_ASSET_DRAG = 'application/x-logcut-asset'

/** Either the importable paths, or the reason there are none. */
export interface FileDrop {
  paths: string[]
  error: string | null
}

/**
 * Resolve a drop from Finder into absolute paths, keeping only media files.
 *
 * Lives here rather than in whichever component drew the drop target: the
 * whole media panel accepts files, both as the empty-state import surface and
 * as the populated grid, and the two must reject the same things with the same
 * words. `getPathForFile` is Electron's webUtils — a File has no usable path
 * without it.
 */
export function fileDropOf(dataTransfer: DataTransfer): FileDrop {
  const files = [...dataTransfer.files]
  if (files.length === 0) return { paths: [], error: null }

  const supported = files.filter((file) => isSupportedMediaFile(file.name))
  if (supported.length === 0) return { paths: [], error: 'Please drop a video file.' }

  const paths = supported.map((file) => window.logcut.getPathForFile(file)).filter(Boolean)
  if (paths.length === 0) return { paths: [], error: 'Could not resolve the file path.' }

  return { paths, error: null }
}
