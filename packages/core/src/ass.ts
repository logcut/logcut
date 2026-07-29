import {
  captionFontSizePct,
  captionLengthFor,
  captionShadowOffset,
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

/** ASS states the *transparent* share, so an opacity has to be turned around
 *  on the way in. 0% opaque is `&HFF&`, fully solid is `&H00&`. */
function assAlpha(opacityPct: number): string {
  const transparent = Math.round((1 - opacityPct / 100) * 255)
  return `&H${pad(transparent.toString(16).toUpperCase(), 2)}&`
}

/** Braces open an override block and newlines end the event outright. A lone
 *  backslash is left alone — ASS has no escape for it, and only `\N`, `\n` and
 *  `\h` mean anything. */
function assText(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N')
}

/** Which pass of a caption an event is, painted in this order, bottom first.
 *  **No two of these can be one event** — under `BorderStyle: 3` the outline
 *  colour *is* the plate's fill, and `\blur` takes the whole event with it (see
 *  ass.md). */
type Layer = 'plate' | 'shadow' | 'text'

/** The passes a caption needs, bottom to top. **Exactly one of them draws the
 *  letterforms** — `text`, always present; letting the plate carry them too
 *  breaks the moment a shadow has to go between the plate and the type. */
function layersFor(style: CaptionStyle): Layer[] {
  return [
    ...(style.background ? (['plate'] as const) : []),
    ...(style.shadow ? (['shadow'] as const) : []),
    'text' as const
  ]
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
  // The shadow is the one pass that does not sit on the caption's own centre.
  // `\pos` is in screen space, so the offset has to be turned by the caption's
  // rotation here — the preview's shadow is inside the rotated block and is
  // already turned by it.
  const offset =
    layer === 'shadow' ? captionShadowOffset(style, height, style.rotation) : { dx: 0, dy: 0 }

  /** Fill colour and how solid it is — a different answer on every layer. */
  const fill =
    layer === 'plate'
      ? // The plate draws no type of its own; the text layer above puts the
        // letterforms in. It still has to *lay out* the text, because that is
        // what gives the box its size.
        [`\\c${assColour(style.color)}`, '\\1a&HFF&']
      : layer === 'shadow'
        ? [`\\c${assColour(style.shadowColor)}`, `\\1a${assAlpha(style.shadowOpacityPct)}`]
        : [`\\c${assColour(style.color)}`, `\\1a${assAlpha(style.fillOpacityPct)}`]

  /** What surrounds the glyphs: the plate's box, nothing, or the stroke. */
  const border =
    layer === 'plate'
      ? [
          // BorderStyle 3 paints the plate in the outline colour, sized by the
          // border widths — `\xbord` and `\ybord` because the padding is not
          // square. Its corners are square too; `backgroundRadius` has nothing
          // to land on here (see ass.md).
          `\\3c${assColour(style.backgroundColor)}`,
          `\\3a${assAlpha(style.backgroundOpacityPct)}`,
          `\\xbord${num(captionLengthFor(style.backgroundPadX, height))}`,
          `\\ybord${num(captionLengthFor(style.backgroundPadY, height))}`
        ]
      : !style.outline
        ? // Unstroked type has no border to draw. Stated rather than left to
          // the style table, so that reading one event tells the whole story.
          ['\\bord0']
        : layer === 'shadow'
          ? [
              // **The shadow of stroked type is stroked too**, in the shadow's
              // own colour: what casts it is the silhouette, stroke included.
              // CSS agrees, so leaving this off makes the burn's shadow
              // visibly thinner than the preview at any real stroke width.
              `\\3c${assColour(style.shadowColor)}`,
              `\\3a${assAlpha(style.shadowOpacityPct)}`,
              `\\bord${num(captionLengthFor(style.outlineWidth, height))}`
            ]
          : [
              `\\3c${assColour(style.outlineColor)}`,
              `\\3a${assAlpha(style.outlineOpacityPct)}`,
              `\\bord${num(captionLengthFor(style.outlineWidth, height))}`
            ]

  const tags = [
    // The stored position is the block's centre, and `\an5` is the one anchor
    // that reads `\pos` the same way.
    '\\an5',
    `\\pos(${num(style.x * width + offset.dx)},${num(style.y * height + offset.dy)})`,
    `\\fn${family}`,
    `\\fs${num((captionFontSizePct(style) / 100) * height)}`,
    `\\b${style.bold ? 1 : 0}`,
    `\\i${style.italic ? 1 : 0}`,
    `\\u${style.underline ? 1 : 0}`,
    ...fill,
    ...border,
    // libass's own shadow is never used: it offsets down-right at a fixed
    // angle, and `shadowAngle` is not fixed.
    '\\shad0',
    `\\blur${layer === 'shadow' ? num(captionLengthFor(style.shadowBlur, height)) : '0'}`,
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
 * One `Style:` per border style, because that is the one field an override tag
 * cannot say. Everything else about a line is stated inline.
 */
const STYLE_LINES = [
  // 3 = the opaque plate.
  'Style: Plate,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,' +
    '0,0,0,0,100,100,0,0,3,0,0,5,0,0,0,1',
  // 1 = outline and shadow, which is what a stroke around the glyphs needs —
  // and what the shadow pass needs too, having no box of its own.
  'Style: Stroke,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,' +
    '0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1'
]

const STYLE_NAME: Record<Layer, string> = { plate: 'Plate', shadow: 'Stroke', text: 'Stroke' }

/** Serialize captions as an ASS document for ffmpeg's `ass` filter. **The
 *  mapping mirrors the preview field for field — that correspondence is the
 *  feature**, so a change to either side is a change to both. The three things
 *  a burn cannot express are listed in ass.md. */
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
    // Each pass goes on the layer above the last, so they paint in the order
    // `layersFor` lists them. Every pass carries identical geometry — same size,
    // spacing, rotation and margins, and the same `\pos` bar the shadow's own
    // offset — which is what keeps the glyphs of one exactly over the glyphs of
    // the next.
    return layersFor(style).map(
      (layer, index) =>
        `Dialogue: ${index},${formatAssTimestamp(line.start)},${formatAssTimestamp(line.end)},` +
        `${STYLE_NAME[layer]},,${margin},${margin},0,,` +
        `${overrides(style, input, layer)}${assText(line.text)}`
    )
  })

  return [...head, ...events, ''].join('\n')
}
