/** All times are in milliseconds, matching the ASR response. */
export interface Word {
  word: string
  start: number
  end: number
  /**
   * Marked by LLM post-processing in a later milestone; the ASR confidence
   * field is unusable (always 0), so this is always false for now.
   */
  suspect: boolean
}

export interface Utterance {
  id: string
  start: number
  end: number
  /** Punctuated sentence text as returned by the ASR. */
  text: string
  speakerId?: string
  words: Word[]
}

/**
 * The spoken content of one media asset. It carries no reference back to the
 * file it came from: which asset a transcript belongs to is the project's
 * business, and a path in here is a platform concept the core has no use for.
 */
export interface Transcript {
  audioDurationMs: number
  utterances: Utterance[]
}

/**
 * Which line an edit landed on — what a caller with a screen would put in
 * view afterwards.
 *
 * It is a fact about the edit, not an instruction: whether to move the
 * playhead there is the caller's decision, and a caller without a screen
 * ignores it entirely.
 */
export interface EditFocus {
  assetId: string
  utteranceId: string
  /**
   * On the transcript's own clock. A caller placing this on a timeline adds
   * the offset of the clip the asset is laid down in.
   */
  timeMs: number
}

/** User-facing transcription language choice. */
export type LanguageOption = 'auto' | 'english' | 'simplified' | 'traditional'

/** Language parameters sent to the ASR request, derived from a LanguageOption. */
export interface TranscribeConfig {
  /** audio.language, e.g. 'en-US'; empty means mixed zh/en recognition. */
  language?: string
  /** request.output_zh_variant, e.g. 'tw' for Taiwan traditional output. */
  zhVariant?: string
}
