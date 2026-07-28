import { randomId } from '@logcut/core'
import type { EditCommand, UtteranceQuery, UtteranceQueryResult } from '@logcut/core'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { AgentDispatchResult, AgentRequest, AgentResponse, AgentSession } from '../shared/ipc'

/**
 * The way in for a caller with no window (see agent-bridge.md).
 *
 * **Main holds no document of its own, deliberately.** The renderer is not a
 * cache of an authoritative copy over here; it *is* the copy, and this module
 * only carries questions to it and answers back. That is what keeps an agent's
 * edits and the user's edits in one undo history with nothing to keep in sync.
 *
 * The cost is that an editor must be on screen.
 */

/**
 * Long enough for a renderer busy with a large transcript, short enough that a
 * wedged or crashing window does not leave an agent waiting indefinitely.
 */
const REQUEST_TIMEOUT_MS = 10_000

/** The editor currently answering, or null when none is mounted. */
let editor: WebContents | null = null

const pending = new Map<string, (response: AgentResponse) => void>()

export function registerAgentBridge(): void {
  ipcMain.on('agent:ready', (event) => {
    editor = event.sender
  })

  ipcMain.on('agent:gone', (event) => {
    // Only the window that registered may withdraw: a second window closing
    // must not silence the one still listening.
    if (editor === event.sender) editor = null
  })

  ipcMain.on('agent:response', (_event, requestId: string, response: AgentResponse) => {
    const settle = pending.get(requestId)
    if (!settle) return
    pending.delete(requestId)
    settle(response)
  })
}

/**
 * Put one request to the editor and wait for its answer.
 *
 * Never rejects. A missing editor and a timeout come back as
 * `{ ok: false, error }` for the same reason the request types do (see
 * shared/ipc.ts): the caller upstream is a model, and a sentence it can read
 * beats an exception someone has to translate.
 */
export async function askEditor(request: AgentRequest): Promise<AgentResponse> {
  const target = editor
  if (!target || target.isDestroyed()) {
    return { ok: false, error: 'No editor is open. Ask the user to open a project first.' }
  }

  const requestId = randomId()
  return new Promise<AgentResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve({ ok: false, error: 'The editor did not answer in time.' })
    }, REQUEST_TIMEOUT_MS)

    pending.set(requestId, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
    target.send('agent:request', requestId, request)
  })
}

/**
 * The three calls above the bridge, each unwrapping the one response shape it
 * expects. A wrong `kind` coming back means the two sides have drifted, which
 * is a bug rather than a state to report — but it still arrives as text, since
 * the only reader upstream is a model.
 */
export async function agentSession(): Promise<AgentSession | string> {
  const response = await askEditor({ kind: 'session' })
  if (!response.ok) return response.error
  return response.kind === 'session' ? response.session : 'Unexpected answer from the editor.'
}

export async function agentQuery(query: UtteranceQuery): Promise<UtteranceQueryResult | string> {
  const response = await askEditor({ kind: 'query', query })
  if (!response.ok) return response.error
  return response.kind === 'query' ? response.result : 'Unexpected answer from the editor.'
}

export async function agentDispatch(
  commands: EditCommand[]
): Promise<AgentDispatchResult | string> {
  const response = await askEditor({ kind: 'dispatch', commands })
  if (!response.ok) return response.error
  return response.kind === 'dispatch' ? response.result : 'Unexpected answer from the editor.'
}
