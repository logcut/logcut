import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { callTool, MCP_TOOLS } from './mcp-tools'

/**
 * An MCP server, so an outside agent can edit the open project.
 *
 * **Written against the protocol directly, not with the reference SDK** —
 * everything the SDK drags in would be bundled into the main process for
 * features a stateless tools-only server never reaches (see mcp-server.md).
 */

/** Fixed so the client config can be written down once and stay written. */
export const MCP_PORT = 19790
const MCP_PATH = '/mcp'

/**
 * The version we implement. Clients send their own; answering with ours is
 * correct even when they differ — the protocol negotiates by each side stating
 * what it speaks.
 */
const PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

let server: http.Server | null = null

export function startMcpServer(): void {
  if (server) return

  server = http.createServer((request, response) => {
    void handle(request, response)
  })

  server.on('error', (cause) => {
    // A port already taken is the common case — a second copy of the app, or
    // something else on this port. The editor works without the server, so this
    // is reported and dropped rather than made fatal.
    console.error(`[mcp] server failed: ${cause.message}`)
    server = null
  })

  // Loopback only. Binding the wildcard would put the open project on the local
  // network, where anything on the same café wifi could edit it.
  server.listen(MCP_PORT, '127.0.0.1')
}

export function stopMcpServer(): void {
  server?.close()
  server = null
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = (request.url ?? '').split('?')[0]
  if (path !== MCP_PATH) return send(response, 404, { error: 'Not found' })

  /**
   * A browser on any page can POST to localhost. Requiring the Origin header to
   * be absent (a real client) or local is what stops a visited web page from
   * quietly rewriting the user's subtitles — the DNS-rebinding defence the
   * transport spec asks for.
   */
  const origin = request.headers.origin
  if (origin !== undefined && !isLocalOrigin(origin)) {
    return send(response, 403, { error: 'Forbidden origin' })
  }

  if (request.method === 'GET' || request.method === 'DELETE') {
    // No server-initiated stream and no session to end: both are optional parts
    // of the transport, and saying so plainly beats leaving a socket open.
    return send(response, 405, { error: 'Method not allowed' })
  }

  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed' })

  let message: JsonRpcRequest
  try {
    message = JSON.parse(await readBody(request)) as JsonRpcRequest
  } catch {
    return send(response, 400, error(null, -32700, 'Parse error'))
  }

  // A notification has no id and takes no reply.
  if (message.id === undefined || message.id === null) {
    return send(response, 202, null)
  }

  send(response, 200, await dispatch(message))
}

async function dispatch(message: JsonRpcRequest): Promise<unknown> {
  const id = message.id ?? null

  switch (message.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'logcut', version: '1.0.0' },
          instructions:
            'Edit the subtitles of the project open in LogCut. Call get_session first ' +
            'to learn what is on the timeline, then find_subtitles to read lines and ' +
            'get their ids — ids cannot be guessed. Every edit lands in the same undo ' +
            'history as the user’s own, and one tool call is one undo step, so pass ' +
            'all the lines of a single change in one call. Times are milliseconds on ' +
            'the asset’s own clock. Editing subtitles never touches the footage.'
        }
      }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }

    case 'tools/call': {
      const params = message.params ?? {}
      const name = typeof params['name'] === 'string' ? params['name'] : ''
      const args =
        typeof params['arguments'] === 'object' && params['arguments'] !== null
          ? (params['arguments'] as Record<string, unknown>)
          : {}

      // A failed tool is reported inside the result, not as a JSON-RPC error:
      // the protocol reserves those for the call itself going wrong, and a
      // model needs to read "no editor is open" as an answer it can act on.
      const outcome = await callTool(name, args)
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: outcome.text }], isError: outcome.isError }
      }
    }

    default:
      return error(id, -32601, `Method not found: ${message.method}`)
  }
}

function error(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  } catch {
    return false
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (body === null) {
    response.writeHead(status)
    response.end()
    return
  }
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text)
  })
  response.end(text)
}
