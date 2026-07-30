import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { JSX } from 'react'
import CaptionSurface from '@/components/CaptionSurface'
import { captionFontStack } from '@/lib/caption-fonts'
import { CAPTION_RENDER_HOOK, type CaptionRenderSpec } from '../../shared/caption-render'
import './styles.css'

/**
 * The offscreen window the export takes its captions from.
 *
 * It mounts the very component the player mounts, so a burned caption is a
 * screenshot of the preview rather than a second rendering of it — the whole
 * reason this page exists (see caption-main.md).
 */
function CaptionFrame({ spec }: { spec: CaptionRenderSpec }): JSX.Element {
  return (
    // Pinned to the origin at exactly the picture's size: the screenshot clips
    // from (0,0), so anything the page adds around this would shift the caption.
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: spec.frame.width,
        height: spec.frame.height,
        overflow: 'hidden'
      }}
    >
      <CaptionSurface
        text={spec.text}
        style={spec.style}
        // **The empty list is deliberate.** `captionFontStack` resolves an
        // installed family to `"Name", <system stack>` — exactly what it returns
        // with no list at all — so asking this window to enumerate the machine's
        // fonts would buy nothing and add a permission prompt to the export.
        fontStack={captionFontStack(spec.style.fontFamily, [])}
        frame={spec.frame}
      />
    </div>
  )
}

// Transparent all the way down, or the screenshot comes back on the app's own
// panel colour. The CDP background override alone is not enough: it only
// applies where the document itself paints nothing (see main/caption-render.md).
document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.body.style.margin = '0'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')
const root = createRoot(container)

declare global {
  interface Window {
    [CAPTION_RENDER_HOOK]?: (spec: CaptionRenderSpec) => Promise<void>
  }
}

window[CAPTION_RENDER_HOOK] = async (spec: CaptionRenderSpec): Promise<void> => {
  // **Synchronous, then two frames, then fonts.** `flushSync` gets the DOM
  // written before this returns; the frames let style and layout settle; and
  // `document.fonts.ready` is what stops a caption being captured in a fallback
  // face while its real one is still loading.
  flushSync(() => root.render(<CaptionFrame spec={spec} />))
  await document.fonts.ready
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
