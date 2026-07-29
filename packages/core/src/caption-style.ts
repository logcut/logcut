export type CaptionAlign = 'left' | 'center' | 'right'

/** How captions look burned into the picture — every field's rationale, and the
 *  four layers they group into, are in caption-style.md. */
export interface CaptionStyle {
  /** A family name, or the `SYSTEM_FONT` sentinel for the platform's own. */
  fontFamily: string
  /** Cap height as a percentage of the **picture's** height, never a pixel
   *  size. */
  fontSizePct: number
  /** Percentage on top of `fontSizePct`; 100 is the size as authored. **It
   *  multiplies the font size and nothing else** — the spacings and the plate
   *  keep their own definitions. */
  scalePct: number
  bold: boolean
  italic: boolean
  underline: boolean
  /** CSS colour, `#rrggbb`. */
  color: string
  /** 0 is invisible, 100 is opaque. No switch beside it, unlike the other
   *  three layers. */
  fillOpacityPct: number
  /** Whether the type is stroked. The three fields below keep their values
   *  while it is off — that is the whole point of a toggle over a zero. */
  outline: boolean
  /** CSS colour, `#rrggbb`. */
  outlineColor: string
  /** 0 is invisible, 100 is solid. */
  outlineOpacityPct: number
  /** **Outward from the glyph's edge, not centred on it**, in pixels at
   *  `CAPTION_REFERENCE_HEIGHT`. The preview has to double it to match. */
  outlineWidth: number
  /** Whether the type casts a shadow; the four fields below survive it being
   *  turned off. */
  shadow: boolean
  /** CSS colour, `#rrggbb`. */
  shadowColor: string
  /** 0 is invisible, 100 is solid. */
  shadowOpacityPct: number
  /** Pixels at `CAPTION_REFERENCE_HEIGHT`; 0 is a hard copy of the
   *  letterforms. **The only blur in the model** — see caption-style.md. */
  shadowBlur: number
  /** Pixels at `CAPTION_REFERENCE_HEIGHT`. A true distance along
   *  `shadowAngle`, not a per-axis offset. */
  shadowDistance: number
  /** Degrees clockwise from due right, so 45 is down and to the right. */
  shadowAngle: number
  /** Whether the caption sits on a plate. **On by default** — every caption
   *  this build has ever burned had one. */
  background: boolean
  /** CSS colour, `#rrggbb`. */
  backgroundColor: string
  /** 0 is invisible, 100 is solid. */
  backgroundOpacityPct: number
  /** How far the plate stands out past the text, in pixels at
   *  `CAPTION_REFERENCE_HEIGHT`. Two numbers, never one. */
  backgroundPadX: number
  backgroundPadY: number
  /** Pixels at `CAPTION_REFERENCE_HEIGHT`. **Preview only** — ASS's opaque box
   *  is square (see ass.md). */
  backgroundRadius: number
  /** Extra space between characters, in pixels at `CAPTION_REFERENCE_HEIGHT`.
   *  0 is the font's own spacing. */
  letterSpacing: number
  /** Extra space between lines, in pixels at `CAPTION_REFERENCE_HEIGHT`. 0 is
   *  the default leading (`DEFAULT_LINE_RATIO`), not zero leading. */
  lineSpacing: number
  align: CaptionAlign
  /** Where the text wraps, as a percentage of the picture's width. **0 means
   *  auto**, which is a different object rather than a narrower one. */
  widthPct: number
  /** **Centre** of the caption block, as a share of the picture's width and
   *  height — scaling and rotation both happen about this point. */
  x: number
  y: number
  /** Clockwise, in degrees. */
  rotation: number
}

/** **The overrides are `Partial` on purpose** — a complete style per speaker
 *  would freeze the base as it stood when that speaker was first touched. */
export interface CaptionStyles {
  base: CaptionStyle
  /** Keyed by `Utterance.speakerId`. */
  bySpeaker: Record<string, Partial<CaptionStyle>>
}

/** "Whatever this platform uses", resolved at render time. A word rather than
 *  the empty string, which a `<Select>` reads as "nothing is selected". */
export const SYSTEM_FONT = 'system'

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: SYSTEM_FONT,
  fontSizePct: 5,
  scalePct: 100,
  bold: false,
  italic: false,
  underline: false,
  color: '#ffffff',
  fillOpacityPct: 100,
  outline: false,
  outlineColor: '#000000',
  outlineOpacityPct: 100,
  outlineWidth: 5,
  shadow: false,
  shadowColor: '#000000',
  shadowOpacityPct: 100,
  shadowBlur: 5,
  shadowDistance: 4,
  shadowAngle: 45,
  // **These four must stay exactly what the two renderers used to hard-code**:
  // changing them restyles every project nobody has touched.
  background: true,
  backgroundColor: '#000000',
  backgroundOpacityPct: 60,
  backgroundPadX: 12,
  backgroundPadY: 4,
  backgroundRadius: 8,
  letterSpacing: 0,
  lineSpacing: 0,
  align: 'center',
  widthPct: 0,
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
 * The size is *stored* as a share of the picture — the only form that survives
 * a 400px preview and a 4K export both — but the controls show pixels, and
 * pixels mean nothing without saying at what size. **A fixed reference, not
 * the preview's own height**, which changes as the window is dragged.
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

/** The share of the picture's height the type actually occupies. **Both the
 *  preview and the burn-in go through here** — the same multiplication written
 *  in two files is drift the two renderers cannot survive. */
export function captionFontSizePct(style: Pick<CaptionStyle, 'fontSizePct' | 'scalePct'>): number {
  return (style.fontSizePct * style.scalePct) / 100
}

/** Where the caption wraps, as a share of the picture's width. **Auto is the
 *  whole picture**, because that is what libass wraps against — see
 *  caption-style.md. */
export function captionWrapShare(widthPct: number): number {
  return widthPct === 0 ? 1 : widthPct / 100
}

/**
 * Where the shadow falls, in pixels for a picture of the given height.
 *
 * **`extraRotation` is whatever the caller's own frame does not already
 * apply**: the preview passes 0 (its block is already turned), ASS passes the
 * caption's rotation (`\pos` is screen space). Both clockwise, y downward.
 * This is the easiest argument in the model to get backwards — the tests lock
 * it step by step.
 */
export function captionShadowOffset(
  style: Pick<CaptionStyle, 'shadowDistance' | 'shadowAngle'>,
  frameHeight: number,
  extraRotation = 0
): { dx: number; dy: number } {
  const distance = captionLengthFor(style.shadowDistance, frameHeight)
  const radians = ((style.shadowAngle + extraRotation) * Math.PI) / 180
  return { dx: distance * Math.cos(radians), dy: distance * Math.sin(radians) }
}

/** Pixels at the reference height → the share this build stores. */
export function captionSizePct(px: number): number {
  // Rounded to the same precision the slider steps in, so that typing the
  // number a slider produced does not store a value a hair away from it.
  return Math.round((px / CAPTION_REFERENCE_HEIGHT) * 1000) / 10
}

/** Leading at `lineSpacing: 0`, as a multiple of the font size. */
export const DEFAULT_LINE_RATIO = 1.3

/** Bounds for the numeric fields, in the units each is stored in. **Exported so
 *  the controls and the validation cannot disagree.** Every one is a length at
 *  `CAPTION_REFERENCE_HEIGHT` except `fontSizePct`, which the controls
 *  convert. */
export const CAPTION_STYLE_LIMITS = {
  fontSizePct: { min: 1, max: 20 },
  scalePct: { min: 10, max: 500 },
  fillOpacityPct: { min: 0, max: 100 },
  outlineOpacityPct: { min: 0, max: 100 },
  outlineWidth: { min: 0, max: 40 },
  shadowOpacityPct: { min: 0, max: 100 },
  shadowBlur: { min: 0, max: 40 },
  shadowDistance: { min: 0, max: 100 },
  // The same dial as `rotation`, so the model's two angles cannot be read
  // differently.
  shadowAngle: { min: -180, max: 180 },
  backgroundOpacityPct: { min: 0, max: 100 },
  backgroundPadX: { min: 0, max: 200 },
  backgroundPadY: { min: 0, max: 200 },
  backgroundRadius: { min: 0, max: 100 },
  letterSpacing: { min: -20, max: 100 },
  lineSpacing: { min: -40, max: 200 },
  // **0 is auto, so the low bound is not a width** — a control offering this
  // range has to say what 0 means rather than show it as a number.
  widthPct: { min: 0, max: 100 },
  // The centre stays on the picture: a caption may hang over an edge, but a
  // centre outside it cannot be grabbed to bring back.
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

/** **Out of range is clamped, not rejected** — it is still a value somebody
 *  meant. `NaN` and the infinities are not, so those fall back to the
 *  default. */
function bounded(key: keyof typeof CAPTION_STYLE_LIMITS) {
  return (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, CAPTION_STYLE_LIMITS[key].min, CAPTION_STYLE_LIMITS[key].max)
      : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Whitelisted, not merely typed: these reach an inline style, and any string
 *  at all would be a CSS injection with a door held open for it. */
function colour(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOUR.test(value) ? value : undefined
}

/** One reader per field. **A table rather than a chain of ifs** because both
 *  callers below need the same per-field rule, and two hand-written copies
 *  would drift the first time a field is added. */
const READERS: {
  [K in keyof CaptionStyle]: (value: unknown) => CaptionStyle[K] | undefined
} = {
  fontFamily: (value) => (typeof value === 'string' && value !== '' ? value : undefined),
  fontSizePct: bounded('fontSizePct'),
  scalePct: bounded('scalePct'),
  bold: bool,
  italic: bool,
  underline: bool,
  color: colour,
  fillOpacityPct: bounded('fillOpacityPct'),
  outline: bool,
  outlineColor: colour,
  outlineOpacityPct: bounded('outlineOpacityPct'),
  outlineWidth: bounded('outlineWidth'),
  shadow: bool,
  shadowColor: colour,
  shadowOpacityPct: bounded('shadowOpacityPct'),
  shadowBlur: bounded('shadowBlur'),
  shadowDistance: bounded('shadowDistance'),
  shadowAngle: bounded('shadowAngle'),
  background: bool,
  backgroundColor: colour,
  backgroundOpacityPct: bounded('backgroundOpacityPct'),
  backgroundPadX: bounded('backgroundPadX'),
  backgroundPadY: bounded('backgroundPadY'),
  backgroundRadius: bounded('backgroundRadius'),
  letterSpacing: bounded('letterSpacing'),
  lineSpacing: bounded('lineSpacing'),
  align: (value) =>
    typeof value === 'string' && (ALIGNMENTS as string[]).includes(value)
      ? (value as CaptionAlign)
      : undefined,
  widthPct: bounded('widthPct'),
  x: bounded('x'),
  y: bounded('y'),
  rotation: bounded('rotation')
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

/** Fill in whatever a stored value is missing, and drop what does not belong.
 *  **Runs on both sides** — reading a project written before a field existed,
 *  and accepting a value from the renderer without a second validator. */
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
