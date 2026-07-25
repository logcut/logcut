import { net } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MEDIA_SCHEME = 'logcut-media'

/** Allow-list of files the renderer may stream: only paths the user dropped. */
const registeredPaths = new Map<string, string>()

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
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
 * Upper bound for a single 206 response. Range replies are buffered (streamed
 * Responses with explicit lengths are unreliable in protocol.handle), so the
 * chunk size caps memory usage; Chromium follows up with further Range
 * requests as playback progresses.
 */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * Handler for the logcut-media:// protocol.
 *
 * File bytes are read through net.fetch (Chromium's file loader honours the
 * Range header but always reports a bare 200), then rewrapped into a proper
 * 206 with Accept-Ranges/Content-Range/Content-Length so the media stack can
 * establish seekable ranges.
 */
export async function handleMediaRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.pathname.replace(/^\//, '')
  const filePath = registeredPaths.get(id)
  if (!filePath || !fs.existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  const { size } = fs.statSync(filePath)
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const fileUrl = pathToFileURL(filePath).toString()

  const rangeHeader = request.headers.get('range')
  const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null
  const start = match ? Number(match[1]) : 0
  if (start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    })
  }
  const requestedEnd = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  const end = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1)

  const upstream = await net.fetch(fileUrl, {
    headers: { Range: `bytes=${start}-${end}` },
    bypassCustomProtocolHandlers: true
  })
  const body = await upstream.arrayBuffer()

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(body.byteLength)
    }
  })
}
