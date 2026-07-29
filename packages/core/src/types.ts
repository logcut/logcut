import type { CaptionStyle } from './caption-style.ts'

/** All times are in milliseconds, matching the ASR response. */
export interface Word {
  word: string
  start: number
  end: number
  /** **Always false today.** The provider's confidence field is unusable — it
   *  is 0 on every word — so nothing sets this yet. */
  suspect: boolean
}

export interface Utterance {
  id: string
  start: number
  end: number
  /** Punctuated sentence text as returned by the ASR. */
  text: string
  speakerId?: string
  /**
   * This line's own look, overriding the project's and its speaker's. Absent
   * unless something was set on this line specifically — the resolution order
   * is in caption-style.ts.
   *
   * It lives on the utterance rather than in a map on the project so that it
   * goes wherever the line goes: deleting the line takes its styling with it,
   * and nothing is left keyed to an id that no longer exists.
   */
  style?: Partial<CaptionStyle>
  words: Word[]
}

/** The spoken content of one media asset. **It carries no reference back to the
 *  file** — which asset a transcript belongs to is the project's business. */
export interface Transcript {
  audioDurationMs: number
  utterances: Utterance[]
}

/** Which line an edit landed on. **A fact about the edit, not an instruction**
 *  — whether to move the playhead is the caller's decision. */
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
