import type { Transcript, Utterance } from './types.ts'

/**
 * Index of the utterance covering `timeMs`, or -1 when the time falls in a gap
 * between utterances or outside the transcript. `end` is exclusive, so the
 * boundary between two adjacent utterances belongs to the later one.
 *
 * Binary search: this runs on every timeupdate (~4Hz) against transcripts that
 * reach a few thousand utterances for an hour of speech. Requires utterances
 * sorted by `start`, which is how the ASR returns them and how segmentation
 * preserves them.
 */
export function findUtteranceIndexAt(utterances: Utterance[], timeMs: number): number {
  let low = 0
  let high = utterances.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const utterance = utterances[mid] as Utterance
    if (timeMs < utterance.start) high = mid - 1
    else if (timeMs >= utterance.end) low = mid + 1
    else return mid
  }
  return -1
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
