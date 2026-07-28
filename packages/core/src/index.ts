export type {
  EditFocus,
  LanguageOption,
  Transcript,
  TranscribeConfig,
  Utterance,
  Word
} from './types.ts'

export { applyCommand, applyCommands } from './commands/index.ts'
export type { CommandOutcome, CommandResult, EditCommand, EditDocument } from './commands/index.ts'
export type { SubtitleCommand, SubtitleOutcome } from './commands/subtitle.ts'

export {
  configCacheKey,
  defaultOption,
  isTraditionalLocale,
  languageOptionToConfig,
  orderedOptions
} from './language.ts'

export {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_STYLES,
  normalizeCaptionStyles,
  resolveCaptionStyle,
  SYSTEM_FONT
} from './caption-style.ts'
export type { CaptionStyle, CaptionStyles } from './caption-style.ts'

export { randomId } from './id.ts'

export { DEFAULT_MAX_CHARS, minCharsFor, segmentTranscript, segmentUtterance } from './segment.ts'
export type { SegmentOptions } from './segment.ts'

export { parseVolcanoResponse } from './volcano.ts'

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
