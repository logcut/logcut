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

export interface Transcript {
  sourcePath: string
  audioDurationMs: number
  utterances: Utterance[]
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
