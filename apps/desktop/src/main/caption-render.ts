import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { CAPTION_RENDER_HOOK, type CaptionRenderSpec } from '../shared/caption-render'

/** One caption's picture, and when it is on screen. */
export interface RenderedCaption {
  /** Bare filename inside the work directory — a filtergraph cannot spell a
   *  path (see packages/core/src/export.md). */
  file: string
  startMs: number
  endMs: number
}

/** How long the offscreen page gets to lay one caption out. Generous: it is a
 *  local render with no network in it, so reaching this means something hung. */
const RENDER_TIMEOUT_MS = 30_000

function pageUrl(): { url: string } | { file: string } {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) return { url: `${dev}/caption.html` }
  return { file: path.join(__dirname, '../renderer/caption.html') }
}

/**
 * Draw every caption offscreen and write it out as a PNG with an alpha channel.
 *
 * **This is the burn.** There is no second renderer that has to agree with the
 * preview — the preview's own component is mounted in a hidden window and
 * photographed (see main/caption-render.md).
 */
export async function renderCaptions({
  captions,
  frame,
  workDir,
  onProgress
}: {
  captions: { text: string; style: CaptionRenderSpec['style']; startMs: number; endMs: number }[]
  frame: { width: number; height: number }
  workDir: string
  onProgress?: (done: number, total: number) => void
}): Promise<RenderedCaption[]> {
  if (captions.length === 0) return []

  const win = new BrowserWindow({
    show: false,
    // Sized to the picture so nothing is scaled on the way out, and transparent
    // so the window itself contributes no pixels.
    width: frame.width,
    height: frame.height,
    transparent: true,
    frame: false,
    // Offscreen windows are still throttled when hidden, and a throttled page
    // does not paint — which is a blank screenshot.
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
      sandbox: false
    }
  })

  try {
    const target = pageUrl()
    await ('url' in target ? win.loadURL(target.url) : win.loadFile(target.file))

    const debug = win.webContents.debugger
    debug.attach('1.3')
    // The two halves of a transparent capture: this one covers whatever the
    // page leaves unpainted, the page itself covers html and body.
    await debug.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 }
    })
    // **Without this the picture comes back at the screen's pixel ratio**, and
    // on a Retina display that is a caption twice the size of the video it has
    // to be laid over. Pinning the ratio to 1 makes one CSS pixel one exported
    // pixel — measured: 3840×2160 before, 1920×1080 after.
    await debug.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: frame.width,
      height: frame.height,
      deviceScaleFactor: 1,
      mobile: false
    })

    const rendered: RenderedCaption[] = []
    for (const [index, caption] of captions.entries()) {
      const spec: CaptionRenderSpec = { text: caption.text, style: caption.style, frame }
      await withTimeout(
        win.webContents.executeJavaScript(
          `window[${JSON.stringify(CAPTION_RENDER_HOOK)}](${JSON.stringify(spec)})`
        ),
        RENDER_TIMEOUT_MS
      )

      const shot = (await debug.sendCommand('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: frame.width, height: frame.height, scale: 1 },
        // The window need not really be that big for the clip to be, which is
        // what lets a 4K caption come out of a window nobody ever shows.
        captureBeyondViewport: true,
        optimizeForSpeed: true
      })) as { data: string }

      const file = `caption-${String(index).padStart(5, '0')}.png`
      fs.writeFileSync(path.join(workDir, file), Buffer.from(shot.data, 'base64'))
      rendered.push({ file, startMs: caption.startMs, endMs: caption.endMs })
      onProgress?.(index + 1, captions.length)
    }

    debug.detach()
    return rendered
  } finally {
    win.destroy()
  }
}

/** A PNG chunk: length, type, payload, CRC over type and payload. */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * A fully transparent PNG of the given size.
 *
 * **Written rather than rendered.** It fills the gaps between captions in the
 * concat list, and every image in that list has to be the same size — asking the
 * offscreen window for it would mean rendering a caption with no text, which
 * still draws a plate.
 */
function transparentPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // Zeroes all the way down: compression 0, filter 0, interlace 0 — and every
  // scanline is a filter byte of 0 followed by transparent black pixels, which
  // is what makes the raw buffer below correct as allocated.
  const raw = Buffer.alloc((width * 4 + 1) * height)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** ffmpeg reads durations in seconds; six decimals is finer than a frame at any
 *  rate anyone exports at. */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(6)
}

/**
 * Turn the rendered captions into one concat list ffmpeg can read as a video
 * track: each caption for exactly as long as it is on screen, transparency
 * everywhere else.
 *
 * **The track outlasts the picture on purpose.** `overlay` repeats a track's
 * last frame after it ends, so a list ending on a caption would pin that
 * caption to the end of the film; it ends on a transparent frame instead.
 */
export function writeCaptionTrack({
  captions,
  frame,
  workDir,
  totalDurationMs
}: {
  captions: RenderedCaption[]
  frame: { width: number; height: number }
  workDir: string
  totalDurationMs: number
}): string | null {
  if (captions.length === 0) return null

  const blank = 'caption-blank.png'
  fs.writeFileSync(path.join(workDir, blank), transparentPng(frame.width, frame.height))

  const lines: string[] = []
  const show = (file: string, durationMs: number): void => {
    if (durationMs <= 0) return
    lines.push(`file '${file}'`, `duration ${seconds(durationMs)}`)
  }

  let cursorMs = 0
  for (const caption of [...captions].sort((a, b) => a.startMs - b.startMs)) {
    // Captions are not meant to overlap, but a transcript is free to say they
    // do; the later one loses the part that has already been shown rather than
    // pushing everything after it out of time.
    const startMs = Math.max(caption.startMs, cursorMs)
    if (caption.endMs <= startMs) continue
    show(blank, startMs - cursorMs)
    show(caption.file, caption.endMs - startMs)
    cursorMs = caption.endMs
  }

  // A tail of transparency past the end of the picture, then the same file
  // again: concat ignores the duration of the last entry, so without the repeat
  // the final gap would be one frame long.
  show(blank, Math.max(totalDurationMs - cursorMs, 0) + 1000)
  lines.push(`file '${blank}'`)

  const listFile = 'captions.txt'
  fs.writeFileSync(path.join(workDir, listFile), `${lines.join('\n')}\n`, 'utf8')
  return listFile
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out laying out a caption')), ms)
    )
  ])
}
