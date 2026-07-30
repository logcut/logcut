import type { CaptionStyle } from '@logcut/core'

/**
 * One caption to draw offscreen, in the picture it will be burned into.
 *
 * **Not an IPC contract**: this crosses from the main process into the offscreen
 * window through `executeJavaScript`, not over the preload bridge — which is why
 * it lives here rather than in shared/ipc.ts (see caption-render.md).
 */
export interface CaptionRenderSpec {
  text: string
  /** Already resolved through the cascade; the window applies it as it stands. */
  style: CaptionStyle
  frame: { width: number; height: number }
}

/** The name the offscreen window publishes its renderer under. Stated once, so
 *  the two sides cannot disagree about it. */
export const CAPTION_RENDER_HOOK = '__logcutRenderCaption'
