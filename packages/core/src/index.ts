export type {
  EditFocus,
  LanguageOption,
  Transcript,
  TranscribeConfig,
  Utterance,
  Word
} from './types.ts'

export { queryUtterances, DEFAULT_QUERY_LIMIT } from './query.ts'
export type { UtteranceQuery, UtteranceQueryResult, UtteranceView } from './query.ts'

export { resolveShortId, shortIdMap, SHORT_ID_FLOOR } from './short-id.ts'

export { applyCommand, applyCommands, replayCommands } from './commands/index.ts'
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
  CAPTION_REFERENCE_HEIGHT,
  CAPTION_STYLE_LIMITS,
  captionFontSizePct,
  captionLengthFor,
  captionShadowOffset,
  captionSizePct,
  captionSizePx,
  captionWrapShare,
  DEFAULT_LINE_RATIO,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_STYLES,
  normalizeCaptionStyles,
  resolveCaptionStyle,
  SYSTEM_FONT
} from './caption-style.ts'
export type { CaptionAlign, CaptionStyle, CaptionStyles } from './caption-style.ts'

export { randomId } from './id.ts'

export { DEFAULT_MAX_CHARS, minCharsFor, segmentTranscript, segmentUtterance } from './segment.ts'
export type { SegmentOptions } from './segment.ts'

export { parseVolcanoResponse } from './volcano.ts'

export { SNAP_TOLERANCE_PX, snapToNearest, utteranceEdges } from './snap.ts'

export { formatSrtTimestamp, toSrt } from './srt.ts'

export { captionLinesFor, planExport } from './export.ts'
export type { CaptionLine } from './export.ts'
export type { CaptionClip, ExportClip, ExportInput, ExportPlan } from './export.ts'

export {
  AUDIO_BITRATE_KBPS,
  AUDIO_SAMPLE_RATE_CHOICES,
  DEFAULT_EXPORT_SETTINGS,
  deriveBitrateKbps,
  FPS_CHOICES,
  normalizeExportSettings,
  RESOLUTION_CHOICES,
  VIDEO_BITRATE_KBPS
} from './export-settings.ts'
export type {
  AudioChannels,
  ExportCodec,
  ExportQuality,
  ExportSettings
} from './export-settings.ts'

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
  setUtteranceStyle,
  splitUtterance,
  setUtteranceText,
  setUtteranceTime,
  speakerIdsOf
} from './transcript.ts'
export type { ReplaceAllResult } from './transcript.ts'
