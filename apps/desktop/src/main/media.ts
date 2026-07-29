import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export const MEDIA_SCHEME = 'logcut-media'

/** Allow-list of files the renderer may stream: only paths the user dropped. */
const registeredPaths = new Map<string, string>()

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // Poster frames go through this protocol too, rather than being inlined as
  // data URLs: the project list would otherwise carry every card's image
  // through structured clone on each refresh.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
}

export function registerMediaPath(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  for (const [id, existing] of registeredPaths) {
    if (existing === filePath) return `${MEDIA_SCHEME}://media/${id}`
  }
  const id = crypto.randomUUID()
  registeredPaths.set(id, filePath)
  return `${MEDIA_SCHEME}://media/${id}`
}

/**
 * Handler for the logcut-media:// protocol.
 *
 * The whole requested range is streamed. Capping the reply at a chunk size
 * and letting Chromium ask for the rest does not work: on this path it takes
 * Content-Length as the size of the entire resource and ignores the total in
 * Content-Range, so it reports the file as fully buffered, never issues a
 * second request, and the decoder fails with PIPELINE_ERROR_DECODE the moment
 * playback runs past the bytes it was handed — a 20 Mbit/s file died 3s in on
 * an 8 MiB cap. Memory stays bounded because Chromium applies backpressure,
 * suspending the read once it has buffered enough.
 */
export function handleMediaRequest(request: Request): Response {
  const url = new URL(request.url)
  const id = url.pathname.replace(/^\//, '')
  const filePath = registeredPaths.get(id)
  if (!filePath || !fs.existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  const { size } = fs.statSync(filePath)
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'

  const rangeHeader = request.headers.get('range')
  const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null
  const start = match ? Number(match[1]) : 0
  if (start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    })
  }
  const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1

  const body = Readable.toWeb(
    fs.createReadStream(filePath, { start, end })
  ) as ReadableStream<Uint8Array>

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      // `corsEnabled` on the scheme only permits the check to happen; without
      // an allowing header it then fails on its own. Any origin, because the
      // only ones that exist are this app's own — file:// when packaged and
      // the dev server otherwise — while what may be served at all is decided
      // by the registered-path allow-list above, not by who is asking.
      'Access-Control-Allow-Origin': '*'
    }
  })
}
