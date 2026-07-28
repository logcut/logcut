import {
  insertUtteranceAfter,
  mergeUtterances,
  removeUtterances,
  replaceAllText,
  setUtteranceSpeaker,
  setUtteranceText,
  setUtteranceTime
} from '../transcript.ts'
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
      kind: 'subtitle.setTime'
      assetId: string
      id: string
      edge: 'start' | 'end'
      timeMs: number
    }
  | { kind: 'subtitle.insertAfter'; assetId: string; afterId: string }
  | { kind: 'subtitle.merge'; assetId: string; firstId: string }
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
 * Only `replaceAll` adds a field, so the union is derived from the command
 * kinds rather than written out again: a new command lands in the general case
 * automatically, and never silently misses one.
 */
export type SubtitleOutcome =
  | {
      kind: Exclude<SubtitleCommand['kind'], 'subtitle.replaceAll'>
      changed: boolean
      focus: EditFocus | null
    }
  | {
      kind: 'subtitle.replaceAll'
      changed: boolean
      focus: EditFocus | null
      /** Occurrences replaced across the whole transcript; 0 when none matched. */
      count: number
    }

export interface SubtitleCommandResult {
  /** The same object when nothing changed, so callers can compare by identity. */
  transcript: Transcript
  outcome: SubtitleOutcome
}

function focusOn(assetId: string, utterance: Utterance | undefined): EditFocus | null {
  return utterance ? { assetId, utteranceId: utterance.id, timeMs: utterance.start } : null
}

function find(transcript: Transcript, id: string): Utterance | undefined {
  return transcript.utterances.find((utterance) => utterance.id === id)
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
      const next = setUtteranceText(transcript, command.id, command.text)
      return {
        transcript: next,
        outcome: {
          kind: command.kind,
          changed: true,
          focus: focusOn(command.assetId, find(next, command.id))
        }
      }
    }

    case 'subtitle.setSpeaker': {
      const next = setUtteranceSpeaker(transcript, command.id, command.speakerId)
      return settle(command.kind, transcript, next, command.assetId, command.id)
    }

    case 'subtitle.setTime': {
      const next = setUtteranceTime(transcript, command.id, command.edge, command.timeMs)
      return settle(command.kind, transcript, next, command.assetId, command.id)
    }

    case 'subtitle.merge': {
      const next = mergeUtterances(transcript, command.firstId)
      // The merged line keeps the first one's id, so the focus is that id in
      // the transcript that came back — its end moved, its start did not.
      return settle(command.kind, transcript, next, command.assetId, command.firstId)
    }

    case 'subtitle.insertAfter': {
      const next = insertUtteranceAfter(transcript, command.afterId)
      if (next === transcript) return { transcript, outcome: unchanged(command.kind) }
      // The new line goes directly after the named one, and it is the line the
      // caller wants in view: an empty subtitle is written by looking at the
      // frame it belongs to.
      const index = next.utterances.findIndex((utterance) => utterance.id === command.afterId)
      return {
        transcript: next,
        outcome: {
          kind: command.kind,
          changed: true,
          focus: focusOn(command.assetId, next.utterances[index + 1])
        }
      }
    }

    case 'subtitle.remove': {
      const next = removeUtterances(transcript, command.ids)
      // No focus: the lines it names are gone, and there is nothing to look at
      // where they were.
      return {
        transcript: next,
        outcome: { kind: command.kind, changed: next !== transcript, focus: null }
      }
    }

    case 'subtitle.replaceAll': {
      const result = replaceAllText(transcript, command.find, command.replace)
      // No focus either, for the opposite reason: it edits the whole transcript
      // at once, so there is no single line the change happened at.
      return {
        transcript: result.transcript,
        outcome: {
          kind: command.kind,
          changed: result.transcript !== transcript,
          focus: null,
          count: result.count
        }
      }
    }
  }
}

/** The shared tail of the cases whose function reports a no-op by identity. */
function settle(
  kind: Exclude<SubtitleCommand['kind'], 'subtitle.replaceAll'>,
  before: Transcript,
  after: Transcript,
  assetId: string,
  id: string
): SubtitleCommandResult {
  if (after === before) return { transcript: before, outcome: unchanged(kind) }
  return {
    transcript: after,
    outcome: { kind, changed: true, focus: focusOn(assetId, find(after, id)) }
  }
}

function unchanged(kind: SubtitleCommand['kind']): SubtitleOutcome {
  return kind === 'subtitle.replaceAll'
    ? { kind, changed: false, focus: null, count: 0 }
    : { kind, changed: false, focus: null }
}
