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

export { formatTimecode, formatTimecodeFull, parseTimecode } from './timecode.ts'

export {
  clampUtteranceTime,
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  insertUtteranceAfter,
  mergeUtterances,
  nextSpeakerId,
  removeUtterances,
  replaceAllText,
  setUtteranceSpeaker,
  setUtteranceText,
  setUtteranceTime,
  speakerIdsOf
} from './transcript.ts'
export type { ReplaceAllResult } from './transcript.ts'
