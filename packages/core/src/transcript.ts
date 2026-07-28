import { randomId } from './id.ts'
import { splitUtteranceAt } from './segment.ts'
import type { CaptionStyle } from './caption-style.ts'
import type { Transcript, Utterance } from './types.ts'

/**
 * Index of the first utterance still running at `timeMs`, or `length` when the
 * time is past the last one.
 *
 * **Requires utterances sorted by `start` and non-overlapping** — which is how
 * the ASR returns them and how segmentation preserves them. Binary search
 * because the lookups on top of this run on every timeupdate.
 */
function firstEndingAfter(utterances: Utterance[], timeMs: number): number {
  let low = 0
  let high = utterances.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((utterances[mid] as Utterance).end > timeMs) high = mid
    else low = mid + 1
  }
  return low
}

/**
 * Index of the utterance covering `timeMs`, or -1 in a gap or outside the
 * transcript. **`end` is exclusive**, so the boundary between two adjacent
 * utterances belongs to the later one.
 *
 * "Which line is playing". For resolving a click use
 * `findNearestUtteranceIndex` — the split is deliberate, see transcript.md.
 */
export function findUtteranceIndexAt(utterances: Utterance[], timeMs: number): number {
  const index = firstEndingAfter(utterances, timeMs)
  const utterance = utterances[index]
  return utterance && timeMs >= utterance.start ? index : -1
}

/** Same, but a gap or either end resolves to the closest utterance instead of
 *  nothing; only an empty list gives -1. "Which line did the user mean" — see
 *  transcript.md for why this must stay separate. */
export function findNearestUtteranceIndex(utterances: Utterance[], timeMs: number): number {
  if (utterances.length === 0) return -1
  const index = firstEndingAfter(utterances, timeMs)
  const candidate = utterances[index]
  // Past the last utterance.
  if (!candidate) return utterances.length - 1
  // Inside it, or before the very first one.
  if (timeMs >= candidate.start) return index
  const previous = utterances[index - 1]
  if (!previous) return index
  // In a gap: whichever edge is nearer, ties going to the earlier line.
  return timeMs - previous.end <= candidate.start - timeMs ? index - 1 : index
}

/** Return a new transcript with one utterance's text replaced. **`words` are
 *  left untouched**: they carry the original ASR timing anchors, while
 *  `utterance.text` is the source of truth for display and SRT export. */
/**
 * Merge a patch into one line's own styling.
 *
 * A merge rather than a replacement: the panel sends the field that changed,
 * and the rest of this line's overrides have to survive it. Returns the same
 * transcript when nothing differs, so a no-op costs no undo entry.
 */
export function setUtteranceStyle(
  transcript: Transcript,
  id: string,
  patch: Partial<CaptionStyle>
): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === id)
  if (index === -1) return transcript

  const current = transcript.utterances[index]
  const entries = Object.entries(patch) as [keyof CaptionStyle, CaptionStyle[keyof CaptionStyle]][]
  // Every field of the patch already holds that value, so this changes nothing.
  if (entries.every(([key, value]) => current.style?.[key] === value)) return transcript

  const utterances = [...transcript.utterances]
  utterances[index] = { ...current, style: { ...current.style, ...patch } }
  return { ...transcript, utterances }
}

/**
 * Replace one line with the two halves of a cut at `timeMs`.
 *
 * Returns the same transcript when the cut is impossible (see
 * `splitUtteranceAt`), so a click that lands between words costs no undo entry.
 */
export function splitUtterance(transcript: Transcript, id: string, timeMs: number): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === id)
  if (index === -1) return transcript

  const halves = splitUtteranceAt(transcript.utterances[index], timeMs)
  if (!halves) return transcript

  const utterances = [...transcript.utterances]
  utterances.splice(index, 1, ...halves)
  return { ...transcript, utterances }
}

export function setUtteranceText(transcript: Transcript, id: string, text: string): Transcript {
  return {
    ...transcript,
    utterances: transcript.utterances.map((utterance) =>
      utterance.id === id ? { ...utterance, text } : utterance
    )
  }
}

export interface ReplaceAllResult {
  transcript: Transcript
  /** Total number of replaced occurrences across all utterances. */
  count: number
}

/**
 * Replace every occurrence of a literal string (no regex semantics) across
 * all utterance texts. Case-sensitive.
 */
export function replaceAllText(
  transcript: Transcript,
  find: string,
  replace: string
): ReplaceAllResult {
  if (find === '') return { transcript, count: 0 }
  let count = 0
  const utterances = transcript.utterances.map((utterance) => {
    const parts = utterance.text.split(find)
    if (parts.length === 1) return utterance
    count += parts.length - 1
    return { ...utterance, text: parts.join(replace) }
  })
  return { transcript: count === 0 ? transcript : { ...transcript, utterances }, count }
}

/**
 * Only two Latin words need a space between them. Chinese runs together, and
 * so does a word followed by punctuation, so a space is the wrong default.
 */
function joinText(before: string, after: string): string {
  if (before === '') return after
  if (after === '') return before
  const spaced = /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after)
  return spaced ? `${before} ${after}` : `${before}${after}`
}

/**
 * Fold the utterance after `firstId` into it, swallowing the silence between
 * (see transcript.md).
 *
 * `words` are concatenated untouched — they are the original timing anchors.
 * Returns the same object when `firstId` is unknown or last.
 */
export function mergeUtterances(transcript: Transcript, firstId: string): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === firstId)
  const first = transcript.utterances[index]
  const second = transcript.utterances[index + 1]
  if (!first || !second) return transcript

  const merged: Utterance = {
    id: first.id,
    start: first.start,
    end: second.end,
    text: joinText(first.text, second.text),
    speakerId: first.speakerId ?? second.speakerId,
    words: [...first.words, ...second.words]
  }
  return {
    ...transcript,
    utterances: [
      ...transcript.utterances.slice(0, index),
      merged,
      ...transcript.utterances.slice(index + 2)
    ]
  }
}

/**
 * Drop utterances by id. **The lines around them keep their own timings** — the
 * removed span becomes silence rather than the rest sliding earlier (see
 * transcript.md).
 *
 * Returns the same object when nothing matched.
 */
export function removeUtterances(transcript: Transcript, ids: string[]): Transcript {
  const doomed = new Set(ids)
  if (doomed.size === 0) return transcript
  const utterances = transcript.utterances.filter((utterance) => !doomed.has(utterance.id))
  if (utterances.length === transcript.utterances.length) return transcript
  return { ...transcript, utterances }
}

/** Put an empty utterance in the silence after `afterId`, filling the gap
 *  exactly. Returns the same object when there is nowhere to put it — unknown
 *  or last id, or the two lines already touch. */
export function insertUtteranceAfter(transcript: Transcript, afterId: string): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === afterId)
  const before = transcript.utterances[index]
  const after = transcript.utterances[index + 1]
  if (!before || !after || after.start <= before.end) return transcript

  const inserted: Utterance = {
    id: randomId(),
    start: before.end,
    end: after.start,
    text: '',
    speakerId: before.speakerId,
    words: []
  }
  return {
    ...transcript,
    utterances: [
      ...transcript.utterances.slice(0, index + 1),
      inserted,
      ...transcript.utterances.slice(index + 1)
    ]
  }
}

/** A line may be short, but it may not collapse to nothing. */
const MIN_DURATION_MS = 10

/**
 * Where an edge would actually land, clamped into the room its neighbours
 * leave. Returns `timeMs` rounded when the line is unknown.
 *
 * Exported so a live preview — a field being dragged — can show the same value
 * the commit will produce. Two copies of this arithmetic would drift, and the
 * drift would only show as a number that jumps when the mouse is released.
 *
 * The bounds are the neighbours themselves, so `utterances` stays sorted and
 * non-overlapping — which every lookup in this file assumes.
 */
export function clampUtteranceTime(
  utterances: Utterance[],
  id: string,
  edge: 'start' | 'end',
  timeMs: number
): number {
  const index = utterances.findIndex((utterance) => utterance.id === id)
  const utterance = utterances[index]
  if (!utterance) return Math.round(timeMs)

  const previous = utterances[index - 1]
  const next = utterances[index + 1]
  const lower = edge === 'start' ? (previous?.end ?? 0) : utterance.start + MIN_DURATION_MS
  const upper =
    edge === 'start' ? utterance.end - MIN_DURATION_MS : (next?.start ?? Number.MAX_SAFE_INTEGER)

  return Math.round(Math.min(Math.max(timeMs, lower), Math.max(lower, upper)))
}

/** Move one edge of a line. **Clamped, never rejected** (see transcript.md). */
export function setUtteranceTime(
  transcript: Transcript,
  id: string,
  edge: 'start' | 'end',
  timeMs: number
): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === id)
  const utterance = transcript.utterances[index]
  if (!utterance) return transcript

  const clamped = clampUtteranceTime(transcript.utterances, id, edge, timeMs)
  if (clamped === utterance[edge]) return transcript

  const moved: Utterance =
    edge === 'start' ? { ...utterance, start: clamped } : { ...utterance, end: clamped }
  return {
    ...transcript,
    utterances: [
      ...transcript.utterances.slice(0, index),
      moved,
      ...transcript.utterances.slice(index + 1)
    ]
  }
}

/** Every speaker the transcript mentions, **sorted numerically** where the id is
 *  a number — see transcript.md for why text sorting is wrong here. */
export function speakerIdsOf(transcript: Transcript): string[] {
  const ids = [...new Set(transcript.utterances.map((u) => u.speakerId).filter(isSpeakerId))]
  return ids.sort((a, b) => {
    const left = Number(a)
    const right = Number(b)
    const leftIsNumber = Number.isFinite(left)
    const rightIsNumber = Number.isFinite(right)
    if (leftIsNumber && rightIsNumber) return left - right
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1
    return a.localeCompare(b)
  })
}

function isSpeakerId(id: string | undefined): id is string {
  return id !== undefined && id !== ''
}

/** The lowest positive integer no one is using, as a string — freed numbers are
 *  reused (see transcript.md). */
export function nextSpeakerId(transcript: Transcript): string {
  const taken = new Set(speakerIdsOf(transcript))
  let candidate = 1
  while (taken.has(String(candidate))) candidate += 1
  return String(candidate)
}

/** Reassign one line to a speaker. Same object back when nothing changes. */
export function setUtteranceSpeaker(
  transcript: Transcript,
  id: string,
  speakerId: string
): Transcript {
  const index = transcript.utterances.findIndex((utterance) => utterance.id === id)
  const utterance = transcript.utterances[index]
  if (!utterance || utterance.speakerId === speakerId) return transcript
  return {
    ...transcript,
    utterances: [
      ...transcript.utterances.slice(0, index),
      { ...utterance, speakerId },
      ...transcript.utterances.slice(index + 1)
    ]
  }
}
