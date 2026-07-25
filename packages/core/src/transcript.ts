import type { Transcript } from './types.ts'

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
