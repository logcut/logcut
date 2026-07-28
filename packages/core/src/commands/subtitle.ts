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
 * Every edit that changes a transcript, as data (see commands/index.md).
 *
 * **`kind` carries its scope as a prefix rather than sitting beside a separate
 * `scope` field**, which keeps this a one-level discriminated union — a nested
 * one needs nested switches, and a missing branch stops being a type error.
 *
 * `assetId` travels in the command because one batch may touch several assets:
 * a rubber-band delete across clips already does.
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
 * **`changed: false` is an ordinary answer, not a failure** — asking for text a
 * line already has is a no-op the caller should see rather than a reason to
 * throw, and it is what keeps a pointless click out of the undo history.
 *
 * `lines` reports the affected lines as they now stand, so a caller holding no
 * copy of the document need not re-fetch. Two commands report none, for
 * opposite reasons: `remove` names what is gone, `replaceAll` may touch
 * hundreds and so reports only how many.
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

/** Apply one command to one transcript. Every case delegates to the function
 *  that already implements the edit; this layer only decides what the command
 *  meant and what to report. */
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
      // Located before the cut, because neither half keeps the id being cut:
      // looking afterwards found nothing and silently focused the first line of
      // the whole transcript.
      const at = transcript.utterances.findIndex((utterance) => utterance.id === command.id)
      const next = splitUtterance(transcript, command.id, command.timeMs)
      if (next === transcript) return { transcript, outcome: unchanged(command.kind) }
      // Focus goes to the second half: the cut is made to work on what follows
      // it, and the first half is already what it was.
      const second = next.utterances[at + 1]
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
