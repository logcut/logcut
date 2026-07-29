import {
  captionFontSizePct,
  captionLengthFor,
  captionWrapShare,
  resolveCaptionStyle,
  SYSTEM_FONT
} from './caption-style.ts'
import type { CaptionStyle, CaptionStyles } from './caption-style.ts'

/** One caption to burn, already on the clock the exported file will run on. */
export interface AssLine {
  start: number
  end: number
  text: string
  speakerId?: string
  style?: Partial<CaptionStyle>
}

export interface AssInput {
  lines: AssLine[]
  styles: CaptionStyles
  /** The picture the captions are burned into, in pixels. */
  frame: { width: number; height: number }
  /** What the `SYSTEM_FONT` sentinel resolves to on the machine doing the burn. */
  systemFont: string
}

/**
 * Horizontal and vertical padding of the caption's backing plate, as lengths at
 * `CAPTION_REFERENCE_HEIGHT`.
 *
 * The preview states these as fixed design tokens (`px-stack` / `py-inline`),
 * which do not grow with the picture — at 4K that plate would be a hairline
 * around type twenty times its size. Reading them as reference-height lengths
 * is what makes them scale like every other measurement in a CaptionStyle, and
 * it reproduces the preview exactly at 1080p.
 */
const PLATE_PAD_X = 12
const PLATE_PAD_Y = 4

/** The plate is black at 60% opacity; ASS states the transparent share. */
const PLATE_ALPHA = Math.round((1 - 0.6) * 255)

function pad(value: number | string, length: number): string {
  return String(value).padStart(length, '0')
}

/** ASS timestamp: H:MM:SS.cc — one hour digit, and centiseconds, not millis. */
export function formatAssTimestamp(ms: number): string {
  const clamped = Math.max(0, ms)
  const hours = Math.floor(clamped / 3_600_000)
  const minutes = Math.floor((clamped % 3_600_000) / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  const centis = Math.floor((clamped % 1000) / 10)
  return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centis, 2)}`
}

/** Trim the float noise that reaches an override tag; ASS reads either form. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** `#rrggbb` → `&HBBGGRR&`. ASS orders the channels backwards from CSS. */
function assColour(hex: string): string {
  const r = hex.slice(1, 3)
  const g = hex.slice(3, 5)
  const b = hex.slice(5, 7)
  return `&H${b}${g}${r}&`.toUpperCase()
}

function assAlpha(value: number): string {
  return `&H${pad(value.toString(16).toUpperCase(), 2)}&`
}

/**
 * Braces open an override block, so text carrying one would be read as markup
 * rather than shown. Newlines end the event outright.
 *
 * A lone backslash is left alone: ASS has no escape for it, and the only
 * sequences that mean anything are `\N`, `\n` and `\h`.
 */
function assText(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N')
}

/**
 * Everything about one line that an override tag can carry.
 *
 * Only `Justify` and `BorderStyle` cannot, which is the whole reason there is
 * more than one `Style:` entry below — the rest is stated per line so that a
 * speaker or utterance override lands where the cascade put it.
 */
function overrides(style: CaptionStyle, input: AssInput, layer: Layer): string {
  const { width, height } = input.frame
  const family = style.fontFamily === SYSTEM_FONT ? input.systemFont : style.fontFamily
  const border =
    layer === 'plate'
      ? [
          // BorderStyle 3 paints the plate in the outline colour, sized by the
          // border widths — `\xbord` and `\ybord` because the padding is not
          // square.
          '\\3c&H000000&',
          `\\3a${assAlpha(PLATE_ALPHA)}`,
          `\\xbord${num(captionLengthFor(PLATE_PAD_X, height))}`,
          `\\ybord${num(captionLengthFor(PLATE_PAD_Y, height))}`
        ]
      : [
          `\\3c${assColour(style.outlineColor)}`,
          `\\3a${assAlpha(Math.round((1 - style.outlineOpacityPct / 100) * 255))}`,
          `\\bord${num(captionLengthFor(style.outlineWidth, height))}`
        ]
  const tags = [
    // The stored position is the block's centre, and `\an5` is the one anchor
    // that reads `\pos` the same way.
    '\\an5',
    `\\pos(${num(style.x * width)},${num(style.y * height)})`,
    `\\fn${family}`,
    `\\fs${num((captionFontSizePct(style) / 100) * height)}`,
    `\\b${style.bold ? 1 : 0}`,
    `\\i${style.italic ? 1 : 0}`,
    `\\u${style.underline ? 1 : 0}`,
    `\\c${assColour(style.color)}`,
    '\\1a&H00&',
    ...border,
    '\\shad0',
    `\\fsp${num(captionLengthFor(style.letterSpacing, height))}`,
    // Rotation is clockwise everywhere in this project and counter-clockwise
    // in ASS. Drop the minus and every rotated caption burns in mirrored.
    `\\frz${num(-style.rotation)}`
  ].join('')
  // Braces are what make this markup rather than the first word of the
  // caption. Without them libass prints the tags verbatim into the picture.
  return `{${tags}}`
}

/**
 * Which of a caption's two passes an event is.
 *
 * **The plate and the stroke cannot be one event.** Under `BorderStyle: 3` the
 * outline colour *is* the plate's fill and the border widths *are* its padding,
 * so asking the same event for a stroke only repaints the box — measured, and
 * the box came out in the stroke's colour. Two events at the same `\pos`, the
 * stroke laid over the plate, is the only arrangement that produces both.
 */
type Layer = 'plate' | 'stroke'

/**
 * One `Style:` per border style, because that is the one field an override tag
 * cannot say. Everything else about a line is stated inline.
 */
const STYLE_LINES = [
  // 3 = the opaque plate.
  'Style: Plate,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,' +
    '0,0,0,0,100,100,0,0,3,0,0,5,0,0,0,1',
  // 1 = outline and shadow, which is what a stroke around the glyphs needs.
  'Style: Stroke,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,' +
    '0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1'
]

const STYLE_NAME: Record<Layer, string> = { plate: 'Plate', stroke: 'Stroke' }

/**
 * Serialize captions as an ASS document for ffmpeg's `ass` filter.
 *
 * The mapping mirrors the preview overlay field for field — that correspondence
 * is the feature, so a change to either side is a change to both.
 *
 * Three things the preview can express and a burn cannot, all of which land at
 * their defaults: line spacing, which has no ASS equivalent at all; the plate's
 * rounded corners; and `align`, whose only expression would be an anchor that
 * moves the block off the centre it is stored at (see ass.md).
 */
export function toAss(input: AssInput): string {
  const resolved = input.lines.map((line) => ({
    line,
    style: resolveCaptionStyle(input.styles, line)
  }))

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${input.frame.width}`,
    `PlayResY: ${input.frame.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    // Without this libass converts the colours on its way to the picture, and
    // the burned caption comes out a different shade from the preview.
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,' +
      ' BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,' +
      ' BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...STYLE_LINES,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]

  const events = resolved.flatMap(({ line, style }) => {
    // Where the line wraps. libass takes an event's limit from `PlayResX` less
    // its margins even when `\pos` has placed it, so the margins are the only
    // way to say it — and being symmetric they leave `\pos` in charge of where
    // the caption actually sits. Auto is zero margins, the whole picture.
    const margin = Math.round((input.frame.width * (1 - captionWrapShare(style.widthPct))) / 2)
    // The stroke goes second and on the layer above, so it is painted over the
    // plate. Both passes carry identical geometry — same `\pos`, size, spacing,
    // rotation and margins — which is what keeps the glyphs of one exactly
    // under the glyphs of the other.
    const layers: Layer[] = style.outline ? ['plate', 'stroke'] : ['plate']
    return layers.map(
      (layer, index) =>
        `Dialogue: ${index},${formatAssTimestamp(line.start)},${formatAssTimestamp(line.end)},` +
        `${STYLE_NAME[layer]},,${margin},${margin},0,,` +
        `${overrides(style, input, layer)}${assText(line.text)}`
    )
  })

  return [...head, ...events, ''].join('\n')
}
