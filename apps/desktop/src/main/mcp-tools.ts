import type { EditCommand } from '@logcut/core'
import { agentDispatch, agentQuery, agentSession } from './agent-bridge'

/**
 * The tools an outside agent gets, and what each one does.
 *
 * Descriptions are not documentation here — they are the whole of what a model
 * knows about this editor before it acts. A tool whose description omits that
 * ids may be prefixes, or that a window selects overlapping lines, produces an
 * agent that guesses those things wrong on its first attempt.
 *
 * Names are snake_case rather than the command's own `subtitle.setText`: tool
 * names reach providers that only accept `[a-zA-Z0-9_-]`, and a dot fails there
 * for reasons a user would have no way to diagnose.
 */

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type ToolArgs = Record<string, unknown>

const ID_NOTE =
  'Ids may be given in the shortened form the read tools return, or in full. An ' +
  'ambiguous prefix changes nothing rather than guessing.'

const ASSET_NOTE =
  'assetId is optional while the timeline holds exactly one asset; with several, ' +
  'name the one to edit (get_session lists them).'

function object(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

const assetIdProperty = {
  type: 'string',
  description: `The asset whose subtitles to edit. ${ASSET_NOTE}`
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'get_session',
    description:
      'Start here. Reports the open project and every clip on the timeline in order, ' +
      'with its assetId, file name, position, and whether its subtitles have been ' +
      'recognized yet. Editing tools act on an asset, and this is where its id comes ' +
      'from. Answers "no editor is open" when the app is showing the project list.',
    inputSchema: object({})
  },
  {
    name: 'find_subtitles',
    description:
      'Read subtitle lines: all of them, or the ones in a time window, or the ones ' +
      'containing a piece of text. Returns each line with the id the editing tools ' +
      'take, its start and end in milliseconds, its text and its speaker.\n\n' +
      'Always read before editing — line ids cannot be guessed. `total` reports how ' +
      'many matched before paging, so a short answer can be told apart from a ' +
      'complete one; page with offset. A time window selects every line it touches, ' +
      'including one that started before the window and runs into it.',
    inputSchema: object({
      assetId: { type: 'string', description: `Restrict to one asset. ${ASSET_NOTE}` },
      fromMs: { type: 'integer', description: 'Window start, on the asset’s own clock.' },
      toMs: { type: 'integer', description: 'Window end, exclusive.' },
      search: {
        type: 'string',
        description: 'Case-insensitive substring. Literal text, not a regular expression.'
      },
      offset: { type: 'integer', description: 'Skip this many matches.' },
      limit: { type: 'integer', description: 'At most this many lines back (default 50).' }
    })
  },
  {
    name: 'set_subtitle_text',
    description:
      'Rewrite the text of one or more lines — fixing what the recognizer misheard is ' +
      'what this is for. Timings are untouched.\n\n' +
      'Pass every line you are fixing in one call: the batch is one undo step, so the ' +
      'user takes back your whole turn with one Cmd+Z rather than one press per line. ' +
      `${ID_NOTE}`,
    inputSchema: object(
      {
        assetId: assetIdProperty,
        edits: {
          type: 'array',
          description: 'The lines to rewrite.',
          items: object({ id: { type: 'string' }, text: { type: 'string' } }, ['id', 'text'])
        }
      },
      ['edits']
    )
  },
  {
    name: 'set_subtitle_speaker',
    description:
      'Reassign lines to a speaker. Speaker ids are the plain numbers the recognizer ' +
      'hands out ("1", "2"); any string is accepted, and a new one simply starts ' +
      `existing. One call is one undo step. ${ID_NOTE}`,
    inputSchema: object(
      {
        assetId: assetIdProperty,
        edits: {
          type: 'array',
          items: object({ id: { type: 'string' }, speakerId: { type: 'string' } }, [
            'id',
            'speakerId'
          ])
        }
      },
      ['edits']
    )
  },
  {
    name: 'set_subtitle_time',
    description:
      'Move one edge of a line. The value is clamped into the room its neighbours ' +
      'leave, so lines never overlap; the outcome reports where the edge actually ' +
      `landed, which may differ from what was asked. One call is one undo step. ${ID_NOTE}`,
    inputSchema: object(
      {
        assetId: assetIdProperty,
        edits: {
          type: 'array',
          items: object(
            {
              id: { type: 'string' },
              edge: { type: 'string', enum: ['start', 'end'] },
              timeMs: { type: 'integer' }
            },
            ['id', 'edge', 'timeMs']
          )
        }
      },
      ['edits']
    )
  },
  {
    name: 'insert_subtitle_after',
    description:
      'Put an empty line in the silence after the named one, filling that gap exactly. ' +
      'It changes nothing when the two lines already touch — there is nowhere to put ' +
      'it. Write its text with set_subtitle_text afterwards; the outcome carries the ' +
      `new line’s id. ${ID_NOTE}`,
    inputSchema: object({ assetId: assetIdProperty, afterId: { type: 'string' } }, ['afterId'])
  },
  {
    name: 'merge_subtitles',
    description:
      'Fold each named line together with the one after it: one line spanning both, ' +
      'the silence between them swallowed. This is how a sentence the recognizer split ' +
      'at a breath gets put back together. The merged line keeps the first one’s id. ' +
      `Merging the last line does nothing. One call is one undo step. ${ID_NOTE}`,
    inputSchema: object(
      {
        assetId: assetIdProperty,
        firstIds: {
          type: 'array',
          description: 'Each is the earlier of a pair to merge.',
          items: { type: 'string' }
        }
      },
      ['firstIds']
    )
  },
  {
    name: 'remove_subtitles',
    description:
      'Delete lines. The lines around them keep their own timings — the removed span ' +
      'becomes silence rather than everything later sliding earlier. **This deletes ' +
      'subtitles, not video**; the footage is untouched. One call is one undo step. ' +
      `${ID_NOTE}`,
    inputSchema: object(
      { assetId: assetIdProperty, ids: { type: 'array', items: { type: 'string' } } },
      ['ids']
    )
  },
  {
    name: 'replace_all_text',
    description:
      'Replace every occurrence of a piece of text across the whole transcript. ' +
      'Literal and case-sensitive, no regular expressions. Reports how many ' +
      'occurrences changed but not the new lines — read them back with find_subtitles ' +
      'if you need them. Consider find_subtitles first to see what it will hit.',
    inputSchema: object(
      {
        assetId: assetIdProperty,
        find: { type: 'string' },
        replace: { type: 'string' }
      },
      ['find', 'replace']
    )
  }
]

/** A tool's answer: text for the model, plus whether it failed. */
export interface ToolOutcome {
  text: string
  isError: boolean
}

function ok(value: unknown): ToolOutcome {
  return { text: JSON.stringify(value), isError: false }
}

function failed(message: string): ToolOutcome {
  return { text: message, isError: true }
}

/**
 * Which asset a command names.
 *
 * Optional while there is one asset, because insisting on it would make every
 * simple edit a two-call affair. With several, refusing beats picking: the
 * wrong guess silently edits the wrong clip's subtitles.
 */
async function assetIdFor(args: ToolArgs): Promise<string | { error: string }> {
  const given = args['assetId']
  if (typeof given === 'string' && given !== '') return given

  const session = await agentSession()
  if (typeof session === 'string') return { error: session }

  const assetIds = [...new Set(session.clips.map((clip) => clip.assetId))]
  const only = assetIds[0]
  if (only === undefined) return { error: 'The timeline is empty. Nothing to edit.' }
  if (assetIds.length > 1) {
    return { error: `Several assets are on the timeline: ${assetIds.join(', ')}. Name one.` }
  }
  return only
}

function edits(args: ToolArgs, key: string): ToolArgs[] {
  const value = args[key]
  return Array.isArray(value) ? value.filter((item): item is ToolArgs => isRecord(item)) : []
}

function isRecord(value: unknown): value is ToolArgs {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function ids(args: ToolArgs, key: string): string[] {
  const value = args[key]
  return Array.isArray(value) ? value.map(str).filter((id) => id !== '') : []
}

/** Run one batch and answer with what it did. */
async function dispatch(commands: EditCommand[]): Promise<ToolOutcome> {
  if (commands.length === 0) return failed('Nothing to do: no edits were given.')
  const result = await agentDispatch(commands)
  if (typeof result === 'string') return failed(result)
  return ok({ changed: result.changed.length > 0, outcomes: result.outcomes })
}

export async function callTool(name: string, args: ToolArgs): Promise<ToolOutcome> {
  switch (name) {
    case 'get_session': {
      const session = await agentSession()
      return typeof session === 'string' ? failed(session) : ok(session)
    }

    case 'find_subtitles': {
      const result = await agentQuery({
        ...(typeof args['assetId'] === 'string' ? { assetId: args['assetId'] } : {}),
        ...(typeof args['fromMs'] === 'number' ? { fromMs: args['fromMs'] } : {}),
        ...(typeof args['toMs'] === 'number' ? { toMs: args['toMs'] } : {}),
        ...(typeof args['search'] === 'string' ? { search: args['search'] } : {}),
        ...(typeof args['offset'] === 'number' ? { offset: args['offset'] } : {}),
        ...(typeof args['limit'] === 'number' ? { limit: args['limit'] } : {})
      })
      return typeof result === 'string' ? failed(result) : ok(result)
    }

    default:
      break
  }

  const assetId = await assetIdFor(args)
  if (typeof assetId !== 'string') return failed(assetId.error)

  switch (name) {
    case 'set_subtitle_text':
      return dispatch(
        edits(args, 'edits').map((edit) => ({
          kind: 'subtitle.setText',
          assetId,
          id: str(edit['id']),
          text: str(edit['text'])
        }))
      )

    case 'set_subtitle_speaker':
      return dispatch(
        edits(args, 'edits').map((edit) => ({
          kind: 'subtitle.setSpeaker',
          assetId,
          id: str(edit['id']),
          speakerId: str(edit['speakerId'])
        }))
      )

    case 'set_subtitle_time':
      return dispatch(
        edits(args, 'edits').map((edit) => ({
          kind: 'subtitle.setTime',
          assetId,
          id: str(edit['id']),
          edge: edit['edge'] === 'end' ? 'end' : 'start',
          timeMs: typeof edit['timeMs'] === 'number' ? edit['timeMs'] : 0
        }))
      )

    case 'insert_subtitle_after':
      return dispatch([{ kind: 'subtitle.insertAfter', assetId, afterId: str(args['afterId']) }])

    case 'merge_subtitles':
      return dispatch(
        ids(args, 'firstIds').map((firstId) => ({ kind: 'subtitle.merge', assetId, firstId }))
      )

    case 'remove_subtitles':
      return dispatch([{ kind: 'subtitle.remove', assetId, ids: ids(args, 'ids') }])

    case 'replace_all_text':
      return dispatch([
        {
          kind: 'subtitle.replaceAll',
          assetId,
          find: str(args['find']),
          replace: str(args['replace'])
        }
      ])

    default:
      return failed(`Unknown tool: ${name}`)
  }
}
