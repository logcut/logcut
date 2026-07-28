/**
 * How captions look burned into the picture.
 *
 * Three scopes are planned and the shape is built for all three from the start,
 * because the storage format is the expensive thing to change later:
 *
 *   base      one complete value, the whole project's captions
 *   bySpeaker partial overrides, applied to every line of one speaker
 *   utterance partial overrides on the line itself (Utterance.style)
 *
 * Only `base` is settable today. The other two resolve correctly already, so
 * the controls for them are UI work rather than another migration.
 *
 * Overrides are partial on purpose: storing a complete style per speaker would
 * freeze whatever the base was at the moment the speaker was first touched, and
 * later changes to the base would silently stop reaching them.
 */
export type CaptionAlign = 'left' | 'center' | 'right'

export interface CaptionStyle {
  /**
   * A family name for CSS and, later, for the burn-in filter. The sentinel
   * `SYSTEM_FONT` means the platform's own UI font — the only choice certain to
   * have glyphs for whatever language the transcript is in.
   */
  fontFamily: string
  /**
   * Cap height as a percentage of the *picture's* height, not a pixel size.
   *
   * A caption has to look the same in a 400px preview pane and in a 4K export,
   * and only a proportion of the frame can promise that. Storing pixels would
   * mean a caption sized against the preview turning microscopic on export —
   * and there is no correction to apply later, because nothing records which
   * size the number was chosen against.
   */
  fontSizePct: number
  bold: boolean
  italic: boolean
  underline: boolean
  /** CSS colour, `#rrggbb`. */
  color: string
  /**
   * Extra space between characters, in pixels at `CAPTION_REFERENCE_HEIGHT`.
   * 0 is the font's own spacing.
   */
  letterSpacing: number
  /**
   * Extra space between lines, in pixels at `CAPTION_REFERENCE_HEIGHT`. 0 is
   * the default leading (`DEFAULT_LINE_RATIO`), not zero leading.
   */
  lineSpacing: number
  align: CaptionAlign
  /**
   * Centre of the caption block, as a share of the picture's width and height.
   * 0.5 / 0.88 is centred near the bottom, where a subtitle normally sits.
   *
   * A share rather than pixels for the same reason the size is: the position
   * has to mean the same thing in a preview pane and in an export.
   */
  x: number
  y: number
  /** Clockwise, in degrees. */
  rotation: number
}

export interface CaptionStyles {
  base: CaptionStyle
  /** Keyed by `Utterance.speakerId`. */
  bySpeaker: Record<string, Partial<CaptionStyle>>
}

/**
 * Stands for "whatever this platform uses", resolved at render time.
 *
 * A word rather than the empty string because the value reaches a `<Select>`,
 * and an empty option value means "nothing is selected" there — the system
 * font would be the one choice that could not be chosen.
 */
export const SYSTEM_FONT = 'system'

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: SYSTEM_FONT,
  fontSizePct: 5,
  bold: false,
  italic: false,
  underline: false,
  color: '#ffffff',
  letterSpacing: 0,
  lineSpacing: 0,
  align: 'center',
  x: 0.5,
  y: 0.88,
  rotation: 0
}

export const DEFAULT_CAPTION_STYLES: CaptionStyles = {
  base: DEFAULT_CAPTION_STYLE,
  bySpeaker: {}
}

/**
 * The frame height a caption size is quoted against.
 *
 * The size is *stored* as a share of the picture, which is the only form that
 * survives a 400px preview and a 4K export both. But "5.5% of the height" is
 * not how anyone thinks about type, so the controls show pixels — and pixels
 * are meaningless without saying at what size, hence a fixed reference rather
 * than the preview's own height, which would change as the window is dragged.
 *
 * 1080 because it is the height most footage is still cut at, so the number
 * shown matches the export for most projects and is a familiar scale for the
 * rest.
 */
export const CAPTION_REFERENCE_HEIGHT = 1080

/** Stored share of the picture height → pixels at the reference height. */
export function captionSizePx(fontSizePct: number): number {
  return Math.round((fontSizePct / 100) * CAPTION_REFERENCE_HEIGHT)
}

/**
 * A length stored against the reference height, scaled to a picture of the
 * given height. Every length in a CaptionStyle but the font size goes through
 * here on its way to CSS.
 */
export function captionLengthFor(referenceLength: number, frameHeight: number): number {
  return (referenceLength / CAPTION_REFERENCE_HEIGHT) * frameHeight
}

/** Pixels at the reference height → the share this build stores. */
export function captionSizePct(px: number): number {
  // Rounded to the same precision the slider steps in, so that typing the
  // number a slider produced does not store a value a hair away from it.
  return Math.round((px / CAPTION_REFERENCE_HEIGHT) * 1000) / 10
}

/**
 * Leading at `lineSpacing: 0`, as a multiple of the font size.
 *
 * Zero extra spacing means normal leading rather than none — lines set solid
 * touch, and nobody reaches for a spacing control expecting that.
 */
export const DEFAULT_LINE_RATIO = 1.3

/**
 * Bounds for the numeric fields, in the units each is stored in. Exported so
 * the controls and the validation cannot disagree about what is offerable.
 *
 * Every one of these is a length at `CAPTION_REFERENCE_HEIGHT` except
 * `fontSizePct`, which the controls convert (see `captionSizePx`) — so what a
 * user types is one consistent kind of number across the whole panel.
 */
export const CAPTION_STYLE_LIMITS = {
  fontSizePct: { min: 1, max: 20 },
  letterSpacing: { min: -20, max: 100 },
  lineSpacing: { min: -40, max: 200 },
  // The centre stays on the picture. A caption may hang over an edge, but a
  // centre outside it is a caption that cannot be grabbed to bring back.
  x: { min: 0, max: 1 },
  y: { min: 0, max: 1 },
  rotation: { min: -180, max: 180 }
} as const

/** What a line ends up looking like, once every scope has had its say. */
export function resolveCaptionStyle(
  styles: CaptionStyles,
  line?: { speakerId?: string; style?: Partial<CaptionStyle> }
): CaptionStyle {
  const speaker = line?.speakerId
  return {
    ...DEFAULT_CAPTION_STYLE,
    ...styles.base,
    ...(speaker === undefined ? {} : (styles.bySpeaker[speaker] ?? {})),
    ...(line?.style ?? {})
  }
}

const ALIGNMENTS: CaptionAlign[] = ['left', 'center', 'right']
const HEX_COLOUR = /^#[0-9a-f]{6}$/i

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * One reader per field: takes whatever was on disk, returns the field or
 * nothing. A table rather than a chain of ifs because both callers below need
 * the same per-field rule — one to build a complete style, one to build a
 * partial — and two hand-written copies of it would drift the first time a
 * field is added.
 */
const READERS: {
  [K in keyof CaptionStyle]: (value: unknown) => CaptionStyle[K] | undefined
} = {
  fontFamily: (value) => (typeof value === 'string' && value !== '' ? value : undefined),
  fontSizePct: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.fontSizePct.min, CAPTION_STYLE_LIMITS.fontSizePct.max)
      : undefined,
  bold: (value) => (typeof value === 'boolean' ? value : undefined),
  italic: (value) => (typeof value === 'boolean' ? value : undefined),
  underline: (value) => (typeof value === 'boolean' ? value : undefined),
  color: (value) => (typeof value === 'string' && HEX_COLOUR.test(value) ? value : undefined),
  letterSpacing: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.letterSpacing.min, CAPTION_STYLE_LIMITS.letterSpacing.max)
      : undefined,
  lineSpacing: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.lineSpacing.min, CAPTION_STYLE_LIMITS.lineSpacing.max)
      : undefined,
  align: (value) =>
    typeof value === 'string' && (ALIGNMENTS as string[]).includes(value)
      ? (value as CaptionAlign)
      : undefined,
  x: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.x.min, CAPTION_STYLE_LIMITS.x.max)
      : undefined,
  y: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.y.min, CAPTION_STYLE_LIMITS.y.max)
      : undefined,
  rotation: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS.rotation.min, CAPTION_STYLE_LIMITS.rotation.max)
      : undefined
}

const KEYS = Object.keys(READERS) as (keyof CaptionStyle)[]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Read a scope that must end up complete: anything missing takes the default. */
function readComplete(stored: unknown): CaptionStyle {
  const raw = asRecord(stored)
  const style = { ...DEFAULT_CAPTION_STYLE }
  for (const key of KEYS) {
    const read = READERS[key](raw[key])
    if (read !== undefined) Object.assign(style, { [key]: read })
  }
  return style
}

/** Read an override: fields that were never set stay unset, so they keep
 *  following whatever is below them. */
function readPartial(stored: unknown): Partial<CaptionStyle> {
  const raw = asRecord(stored)
  const style: Partial<CaptionStyle> = {}
  for (const key of KEYS) {
    if (!(key in raw)) continue
    const read = READERS[key](raw[key])
    if (read !== undefined) Object.assign(style, { [key]: read })
  }
  return style
}

/**
 * Fill in whatever a stored value is missing, and drop what does not belong.
 *
 * Runs on both sides: a project written before a field existed has to keep
 * opening, and the same guarantee makes a value arriving from the renderer safe
 * to store without a second validator. Numbers are clamped rather than rejected
 * — a value out of range is a value someone meant, just further than this
 * build allows.
 */
export function normalizeCaptionStyles(stored: unknown): CaptionStyles {
  const raw = asRecord(stored)
  return {
    base: readComplete(raw.base),
    bySpeaker: Object.fromEntries(
      Object.entries(asRecord(raw.bySpeaker)).map(([speakerId, override]) => [
        speakerId,
        readPartial(override)
      ])
    )
  }
}
