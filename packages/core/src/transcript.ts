import type { Transcript, Utterance } from './types.ts'

/**
 * Index of the first utterance still running at `timeMs`, or `length` when the
 * time is past the last one.
 *
 * Binary search: the lookups built on this run on every timeupdate (~4Hz)
 * against transcripts that reach a few thousand utterances for an hour of
 * speech. Requires utterances sorted by `start` and non-overlapping, which is
 * how the ASR returns them and how segmentation preserves them.
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
 * Index of the utterance covering `timeMs`, or -1 when the time falls in a gap
 * between utterances or outside the transcript. `end` is exclusive, so the
 * boundary between two adjacent utterances belongs to the later one.
 *
 * This is the lookup for "which line is playing", where a gap genuinely means
 * no line. For resolving a click, use findNearestUtteranceIndex.
 */
export function findUtteranceIndexAt(utterances: Utterance[], timeMs: number): number {
  const index = firstEndingAfter(utterances, timeMs)
  const utterance = utterances[index]
  return utterance && timeMs >= utterance.start ? index : -1
}

/**
 * Same, but a time in a gap or off either end resolves to the closest
 * utterance instead of nothing. Only an empty list gives -1.
 *
 * The timeline needs this rather than an exact hit: it is fit-to-width, so a
 * line is a few pixels wide and the silence between two lines is exactly as
 * clickable. Requiring a hit made clicking a subtitle fail most of the time,
 * with no feedback to say why.
 */
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

/**
 * Return a new transcript with one utterance's text replaced.
 * Words are intentionally left untouched: they carry the original ASR timing
 * anchors, while utterance.text is the single source of truth for display and
 * SRT export.
 */
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
