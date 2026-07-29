/** Codec families the app offers, named by what they are rather than by the
 *  platform encoder that happens to implement one (see main/ffmpeg.md). */
export type ExportCodec = 'h264' | 'hevc'

export type ExportQuality = 'high' | 'medium' | 'low'

export type AudioChannels = 1 | 2

/** What the export dialog holds, and what a project remembers between exports.
 *  **Zero means "follow the source" for the three sizing fields** — the only
 *  values that stay right when the media changes (see export-settings.md). */
export interface ExportSettings {
  /** Canvas, or 0 × 0 to take the first clip's. */
  width: number
  height: number
  codec: ExportCodec
  quality: ExportQuality
  /** Video bitrate in kbit/s, or 0 to derive it from the canvas and quality. */
  videoBitrateKbps: number
  /** Frames per second, or 0 to leave every clip's own rate alone. */
  fps: number
  audioChannels: AudioChannels
  audioSampleRate: number
  audioBitrateKbps: number
  /** Drop the audio track entirely. */
  videoOnly: boolean
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  width: 0,
  height: 0,
  codec: 'h264',
  quality: 'medium',
  videoBitrateKbps: 0,
  fps: 0,
  audioChannels: 2,
  audioSampleRate: 48_000,
  audioBitrateKbps: 192,
  videoOnly: false
}

/** Offered canvases, widest first. `0 × 0` is "match the first clip". */
export const RESOLUTION_CHOICES: { width: number; height: number }[] = [
  { width: 0, height: 0 },
  { width: 3840, height: 2160 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 854, height: 480 }
]

/** Offered frame rates. 0 is "leave the source alone". */
export const FPS_CHOICES = [0, 24, 25, 30, 50, 60]

export const AUDIO_SAMPLE_RATE_CHOICES = [44_100, 48_000]

export const AUDIO_BITRATE_KBPS = { min: 64, max: 512 }
export const VIDEO_BITRATE_KBPS = { min: 500, max: 100_000 }

/** Bits per pixel per second at each quality, before the codec has its say.
 *  `medium` lands 1080p30 at about 8 Mbit/s. **Never exposed as raw numbers** —
 *  the dialog offers the three words and the bitrate they produce. */
const BITS_PER_PIXEL: Record<ExportQuality, number> = {
  high: 0.006,
  medium: 0.004,
  low: 0.0025
}

/** HEVC carries the same picture in appreciably less, so asking for the same
 *  bitrate would quietly spend the saving rather than take it. */
const CODEC_FACTOR: Record<ExportCodec, number> = { h264: 1, hevc: 0.6 }

/** The bitrate a canvas is worth at this quality, in kbit/s. **In core because
 *  the dialog shows the number before anything is exported** — a second
 *  implementation would eventually disagree with the one that runs. */
export function deriveBitrateKbps(
  width: number,
  height: number,
  quality: ExportQuality,
  codec: ExportCodec
): number {
  const raw = width * height * BITS_PER_PIXEL[quality] * CODEC_FACTOR[codec]
  return Math.min(VIDEO_BITRATE_KBPS.max, Math.max(VIDEO_BITRATE_KBPS.min, Math.round(raw)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(clamp(value, min, max))
}

function readChoice<T>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback
}

/** Fill in whatever was missing and drop what does not belong. **Runs on both
 *  sides of the disk**, like `normalizeCaptionStyles` and for the same reason. */
export function normalizeExportSettings(stored: unknown): ExportSettings {
  const raw: Record<string, unknown> =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const defaults = DEFAULT_EXPORT_SETTINGS

  // A canvas is one decision, not two: half of a stored size is not a size, and
  // taking one axis from disk and the other from the default would silently
  // stretch the picture.
  const size = RESOLUTION_CHOICES.find(
    (choice) => choice.width === raw.width && choice.height === raw.height
  ) ?? { width: defaults.width, height: defaults.height }

  return {
    width: size.width,
    height: size.height,
    codec: readChoice<ExportCodec>(raw.codec, ['h264', 'hevc'], defaults.codec),
    quality: readChoice<ExportQuality>(raw.quality, ['high', 'medium', 'low'], defaults.quality),
    // The one field where zero is a value rather than a missing one: it means
    // "derive it". Everything else clamps into its range.
    videoBitrateKbps:
      raw.videoBitrateKbps === 0
        ? 0
        : readNumber(
            raw.videoBitrateKbps,
            defaults.videoBitrateKbps,
            VIDEO_BITRATE_KBPS.min,
            VIDEO_BITRATE_KBPS.max
          ),
    fps: readChoice(raw.fps, FPS_CHOICES, defaults.fps),
    audioChannels: readChoice<AudioChannels>(raw.audioChannels, [1, 2], defaults.audioChannels),
    audioSampleRate: readChoice(
      raw.audioSampleRate,
      AUDIO_SAMPLE_RATE_CHOICES,
      defaults.audioSampleRate
    ),
    audioBitrateKbps: readNumber(
      raw.audioBitrateKbps,
      defaults.audioBitrateKbps,
      AUDIO_BITRATE_KBPS.min,
      AUDIO_BITRATE_KBPS.max
    ),
    videoOnly: typeof raw.videoOnly === 'boolean' ? raw.videoOnly : defaults.videoOnly
  }
}
