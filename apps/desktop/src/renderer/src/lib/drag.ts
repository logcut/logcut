/**
 * The drag type that moves an asset from the media library onto the timeline.
 *
 * A custom type rather than 'text/plain' so the timeline can tell an asset
 * apart from any other drag — a file dragged in from Finder, or selected text
 * — with dataTransfer.types alone, which is all the dragover event is allowed
 * to see.
 */
export const MEDIA_ASSET_DRAG = 'application/x-logcut-asset'
