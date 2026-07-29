import { queryUtterances, shortIdMap } from '@logcut/core'
import type {
  CommandOutcome,
  CommandResult,
  EditCommand,
  EditDocument,
  UtteranceQueryResult,
  UtteranceView
} from '@logcut/core'
import { useEffect, useRef } from 'react'
import type {
  AgentDispatchResult,
  AgentRequest,
  AgentResponse,
  AgentSession
} from '../../../shared/ipc'

interface AgentBridge {
  /** What is open and what is on the timeline. */
  session(): AgentSession
  /** The document to answer queries against. */
  doc(): EditDocument
  /** Runs a batch exactly as a click would, and follows where it landed. */
  dispatch(commands: EditCommand[]): CommandResult
}

/** Answer an agent for as long as the editor is on screen — the answers are the
 *  editor's own state, and main deliberately holds no copy (see
 *  main/agent-bridge.md).
 *
 *  **The handlers are read through a ref so the subscription survives every
 *  render**: re-subscribing would drop requests in flight, and this component
 *  re-renders on every timeupdate. */
export function useAgentBridge(bridge: AgentBridge): void {
  const ref = useRef(bridge)
  ref.current = bridge

  useEffect(() => {
    return window.logcut.onAgentRequest((request: AgentRequest): AgentResponse => {
      switch (request.kind) {
        case 'session':
          return { ok: true, kind: 'session', session: ref.current.session() }
        case 'query': {
          const doc = ref.current.doc()
          return {
            ok: true,
            kind: 'query',
            result: shortenQuery(queryUtterances(doc, request.query), shorten(doc))
          }
        }
        case 'dispatch': {
          const { doc, ...result } = ref.current.dispatch(request.commands)
          // The map comes from the document the batch produced, not from
          // `ref.current.doc()`: that reads React state this dispatch has only
          // just asked to change, so a line just inserted would not be in it.
          // Removed ids are folded in for the same reason from the other side —
          // they are gone from the new document but still named in the answer.
          return {
            ok: true,
            kind: 'dispatch',
            result: shortenResult(result, shorten(doc, removedIn(result.outcomes)))
          }
        }
      }
    })
  }, [])
}

/**
 * **The boundary where ids get shortened, and the only one.** Inside the app an
 * id is the whole UUID; what leaves for a model is not.
 *
 * The map is built from **the whole document**, never from the lines being
 * returned — see packages/core/src/short-id.ts for what breaks otherwise.
 *
 * Nothing is undone on the way in: commands accept a prefix as readily as a
 * full id.
 */
function shorten(doc: EditDocument, alsoKnown: string[] = []): (id: string) => string {
  const map = shortIdMap([
    ...Object.values(doc.transcripts).flatMap((transcript) =>
      transcript.utterances.map((utterance) => utterance.id)
    ),
    ...alsoKnown
  ])
  return (id: string) => map.get(id) ?? id
}

function removedIn(outcomes: CommandOutcome[]): string[] {
  return outcomes.flatMap((outcome) =>
    outcome.kind === 'subtitle.remove' ? outcome.removedIds : []
  )
}

function shortenLine(line: UtteranceView, short: (id: string) => string): UtteranceView {
  return { ...line, id: short(line.id) }
}

function shortenQuery(
  result: UtteranceQueryResult,
  short: (id: string) => string
): UtteranceQueryResult {
  return { ...result, lines: result.lines.map((line) => shortenLine(line, short)) }
}

function shortenOutcome(outcome: CommandOutcome, short: (id: string) => string): CommandOutcome {
  const lines = outcome.lines.map((line) => shortenLine(line, short))
  const focus =
    outcome.focus === null
      ? null
      : { ...outcome.focus, utteranceId: short(outcome.focus.utteranceId) }

  if (outcome.kind === 'subtitle.remove') {
    return { ...outcome, lines, focus, removedIds: outcome.removedIds.map(short) }
  }
  return { ...outcome, lines, focus }
}

function shortenResult(
  result: AgentDispatchResult,
  short: (id: string) => string
): AgentDispatchResult {
  return { ...result, outcomes: result.outcomes.map((outcome) => shortenOutcome(outcome, short)) }
}
