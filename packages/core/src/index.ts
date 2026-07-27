export type { LanguageOption, Transcript, TranscribeConfig, Utterance, Word } from './types.ts'

export {
  configCacheKey,
  defaultOption,
  isTraditionalLocale,
  languageOptionToConfig,
  orderedOptions
} from './language.ts'

export { randomId } from './id.ts'

export { segmentTranscript, segmentUtterance } from './segment.ts'
export type { SegmentOptions } from './segment.ts'

export { formatSrtTimestamp, toSrt } from './srt.ts'

export {
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  replaceAllText,
  setUtteranceText
} from './transcript.ts'
export type { ReplaceAllResult } from './transcript.ts'
