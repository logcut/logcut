import type { UtteranceView } from '../query.ts'
import { resolveShortId } from '../short-id.ts'
import {
  insertUtteranceAfter,
  mergeUtterances,
  removeUtterances,
  replaceAllText,
  setUtteranceSpeaker,
  setUtteranceStyle,
  splitUtterance,
  setUtteranceText,
  setUtteranceTime
} from '../transcript.ts'
import type { CaptionStyle } from '../caption-style.ts'
import type { EditFocus, Transcript, Utterance } from '../types.ts'

/**
 * Every edit that changes a transcript, as data.
 *
 * The functions in `transcript.ts` take a transcript and give one back, which
 * is exactly what a caller holding the transcript wants and exactly what a
 * caller on the other end of a wire cannot express. These are the same edits
 * written as values: a chat model can emit one, an IPC channel can carry one,
 * a log can replay one.
 *
 * `kind` carries its scope as a prefix rather than sitting next to a separate
 * `scope` field. It stays a one-level discriminated union that way — a nested
 * one needs nested switches, and a missing branch stops being a type error —
 * and the string doubles as the name this edit goes by everywhere else: a tool
 * name for a model, an entry in a log, the subject of an error message.
 *
 * `assetId` travels in the command because one batch may touch the subtitles of
 * several assets at once. A rubber-band delete across clips already does.
 */
export type SubtitleCommand =
  | { kind: 'subtitle.setText'; assetId: string; id: string; text: string }
  | { kind: 'subtitle.setSpeaker'; assetId: string; id: string; speakerId: string }
  | {
      kind: 'subtitle.setStyle'
      assetId: string
      id: string
      /** Merged into whatever this line already overrides, not a replacement. */
      style: Partial<CaptionStyle>
    }
  | {
      kind: 'subtitle.setTime'
      assetId: string
      id: string
      edge: 'start' | 'end'
      timeMs: number
    }
  | { kind: 'subtitle.insertAfter'; assetId: string; afterId: string }
  | { kind: 'subtitle.merge'; assetId: string; firstId: string }
  | {
      kind: 'subtitle.split'
      assetId: string
      id: string
      /** On the transcript's own clock, not the timeline's. */
      timeMs: number
    }
  | { kind: 'subtitle.remove'; assetId: string; ids: string[] }
  | { kind: 'subtitle.replaceAll'; assetId: string; find: string; replace: string }

/**
 * What one command did.
 *
 * `changed: false` is an ordinary answer, not a failure — asking for the text a
 * line already has, or a merge with nothing after it, is a no-op the caller
 * should be able to see rather than a reason to throw. It is also what keeps a
 * pointless click out of the undo history.
 *
 * **`lines` is what makes a reader able to skip re-reading.** A caller with no
 * copy of the document — an assistant working from queries — would otherwise
 * have to fetch the transcript again after every edit to know what it now says.
 * Reporting the affected lines as they now stand costs a few hundred bytes and
 * saves a round trip and a page of context each time.
 *
 * Two commands report no lines, for opposite reasons: `remove` names what is
 * gone (`removedIds`), and `replaceAll` may touch hundreds at once, so it
 * reports only how many — a reader that needs the new text queries for it.
 */
interface OutcomeBase {
  changed: boolean
  focus: EditFocus | null
  /** The affected lines as they now stand. Empty when nothing changed. */
  lines: UtteranceView[]
}

export type SubtitleOutcome =
  | (OutcomeBase & {
      kind: Exclude<SubtitleCommand['kind'], 'subtitle.remove' | 'subtitle.replaceAll'>
    })
  | (OutcomeBase & {
      kind: 'subtitle.remove'
      /** The lines actually dropped — may be fewer than the command named. */
      removedIds: string[]
    })
  | (OutcomeBase & {
      kind: 'subtitle.replaceAll'
      /** Occurrences replaced across the whole transcript; 0 when none matched. */
      count: number
    })

export interface SubtitleCommandResult {
  /** The same object when nothing changed, so callers can compare by identity. */
  transcript: Transcript
  outcome: SubtitleOutcome
}

function focusOn(assetId: string, utterance: Utterance | undefined): EditFocus | null {
  return utterance ? { assetId, utteranceId: utterance.id, timeMs: utterance.start } : null
}

function viewOf(assetId: string, utterance: Utterance | undefined): UtteranceView[] {
  if (!utterance) return []
  return [
    {
      assetId,
      id: utterance.id,
      startMs: utterance.start,
      endMs: utterance.end,
      text: utterance.text,
      ...(utterance.speakerId === undefined ? {} : { speakerId: utterance.speakerId })
    }
  ]
}

/**
 * The line a command names.
 *
 * Ids arrive from two kinds of caller: the editor passes the full id it is
 * already holding, an assistant passes whatever it was shown, which may have
 * been shortened (see short-id.ts). Both are accepted here so neither caller
 * needs to know about the other's habits. An exact match short-circuits, so the
 * editor's path costs one comparison.
 *
 * An ambiguous prefix resolves to nothing rather than to the first candidate:
 * editing an arbitrary line and reporting success is worse than doing nothing.
 */
function find(transcript: Transcript, idOrPrefix: string): Utterance | undefined {
  const exact = transcript.utterances.find((utterance) => utterance.id === idOrPrefix)
  if (exact) return exact
  const resolved = resolveShortId(
    idOrPrefix,
    transcript.utterances.map((utterance) => utterance.id)
  )
  return resolved === null
    ? undefined
    : transcript.utterances.find((utterance) => utterance.id === resolved)
}

/**
 * Apply one command to one transcript.
 *
 * Every case delegates to the function that already implements the edit; this
 * layer only decides what the command meant and what to report back. Two
 * implementations of "merge two lines" would be one too many, and the second
 * one would be the one nobody tests.
 */
export function applySubtitleCommand(
  transcript: Transcript,
  command: SubtitleCommand
): SubtitleCommandResult {
  switch (command.kind) {
    case 'subtitle.setText': {
      // The only edit whose function cannot report "nothing happened" by
      // identity: it rebuilds the utterance whether or not the text differs.
      // Asking first is cheaper than the undo entry it would otherwise cost.
      const before = find(transcript, command.id)
      if (!before || before.text === command.text) {
        return { transcript, outcome: unchanged(command.kind) }
      }
      const next = setUtteranceText(transcript, before.id, command.text)
      return landed(command.kind, next, command.assetId, find(next, before.id))
    }

    case 'subtitle.setStyle': {
      const next = setUtteranceStyle(transcript, command.id, command.style)
      if (next === transcript) return { transcript, outcome: unchanged(command.kind) }
      return landed(command.kind, next, command.assetId, find(next, command.id))
    }

    case 'subtitle.setSpeaker': {
      const before = find(transcript, command.id)
      if (!before) return { transcript, outcome: unchanged(command.kind) }
      const next = setUtteranceSpeaker(transcript, before.id, command.speakerId)
      return settle(command.kind, transcript, next, command.assetId, before.id)
    }

    case 'subtitle.setTime': {
      const before = find(transcript, command.id)
      if (!before) return { transcript, outcome: unchanged(command.kind) }
      const next = setUtteranceTime(transcript, before.id, command.edge, command.timeMs)
      return settle(command.kind, transcript, next, command.assetId, before.id)
    }

    case 'subtitle.split': {
      const next = splitUtterance(transcript, command.id, command.timeMs)
      if (next === transcript) return { transcript, outcome: unchanged(command.kind) }
      // Focus goes to the second half: the cut is made to work on what follows
      // it, and the first half is already what it was.
      const at = next.utterances.findIndex((utterance) => utterance.id === command.id)
      const second = next.utterances[at + 1] ?? next.utterances[at]
      return landed(command.kind, next, command.assetId, second)
    }

    case 'subtitle.merge': {
      const before = find(transcript, command.firstId)
      if (!before) return { transcript, outcome: unchanged(command.kind) }
      const next = mergeUtterances(transcript, before.id)
      // The merged line keeps the first one's id, so the line to report is that
      // id in the transcript that came back — its end moved, its start did not.
      return settle(command.kind, transcript, next, command.assetId, before.id)
    }

    case 'subtitle.insertAfter': {
      const after = find(transcript, command.afterId)
      if (!after) return { transcript, outcome: unchanged(command.kind) }
      const next = insertUtteranceAfter(transcript, after.id)
      if (next === transcript) return { transcript, outcome: unchanged(command.kind) }
      // The new line goes directly after the named one, and it is the line the
      // caller wants in view: an empty subtitle is written by looking at the
      // frame it belongs to.
      const index = next.utterances.findIndex((utterance) => utterance.id === after.id)
      return landed(command.kind, next, command.assetId, next.utterances[index + 1])
    }

    case 'subtitle.remove': {
      // Resolved before removing, so a caller naming lines by prefix is
      // answered with the ids that were actually dropped.
      const removedIds = command.ids.flatMap((id) => {
        const line = find(transcript, id)
        return line ? [line.id] : []
      })
      const next = removeUtterances(transcript, removedIds)
      const changed = next !== transcript
      // No lines: the ones it named are gone, and there is nothing to look at
      // where they were.
      return {
        transcript: next,
        outcome: {
          kind: command.kind,
          changed,
          focus: null,
          lines: [],
          removedIds: changed ? removedIds : []
        }
      }
    }

    case 'subtitle.replaceAll': {
      const result = replaceAllText(transcript, command.find, command.replace)
      // No lines either, for the opposite reason: it may rewrite hundreds at
      // once, so it reports how many and leaves the new text to a query.
      return {
        transcript: result.transcript,
        outcome: {
          kind: command.kind,
          changed: result.transcript !== transcript,
          focus: null,
          lines: [],
          count: result.count
        }
      }
    }
  }
}

/** The tail of a case that definitely changed something. */
function landed(
  kind: Exclude<SubtitleCommand['kind'], 'subtitle.remove' | 'subtitle.replaceAll'>,
  transcript: Transcript,
  assetId: string,
  utterance: Utterance | undefined
): SubtitleCommandResult {
  return {
    transcript,
    outcome: {
      kind,
      changed: true,
      focus: focusOn(assetId, utterance),
      lines: viewOf(assetId, utterance)
    }
  }
}

/** The shared tail of the cases whose function reports a no-op by identity. */
function settle(
  kind: Exclude<SubtitleCommand['kind'], 'subtitle.remove' | 'subtitle.replaceAll'>,
  before: Transcript,
  after: Transcript,
  assetId: string,
  id: string
): SubtitleCommandResult {
  if (after === before) return { transcript: before, outcome: unchanged(kind) }
  return landed(kind, after, assetId, find(after, id))
}

function unchanged(kind: SubtitleCommand['kind']): SubtitleOutcome {
  const base = { changed: false, focus: null, lines: [] }
  if (kind === 'subtitle.replaceAll') return { ...base, kind, count: 0 }
  if (kind === 'subtitle.remove') return { ...base, kind, removedIds: [] }
  return { ...base, kind }
}
