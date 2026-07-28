import { SYSTEM_FONT } from '@logcut/core'

export interface CaptionFont {
  /** Stored value, as it appears in CaptionStyle.fontFamily. */
  value: string
  label: string
  /** CSS font-family for both the preview and this row of the picker. */
  stack: string
}

/**
 * The platform's own UI font: always offered, always first, and the default.
 *
 * It is the only entry certain to have glyphs for whatever language the
 * transcript is in, and the only one that survives the project being opened on
 * another machine — so it stays at the top even once the installed fonts are
 * listed below it.
 */
export const SYSTEM_CAPTION_FONT: CaptionFont = {
  value: SYSTEM_FONT,
  label: 'System',
  stack:
    'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
}

/**
 * The three families this app bundles. Offered before the machine's own fonts
 * have been read, and as the fallback when they cannot be — all Latin-only, so
 * a CJK caption set in one of them falls back to a system font anyway.
 */
const BUNDLED_FONTS: CaptionFont[] = [
  { value: 'Inter', label: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  {
    value: 'Space Grotesk',
    label: 'Space Grotesk',
    stack: '"Space Grotesk", system-ui, sans-serif'
  },
  {
    value: 'IBM Plex Mono',
    label: 'IBM Plex Mono',
    stack: '"IBM Plex Mono", ui-monospace, monospace'
  }
]

export const FALLBACK_CAPTION_FONTS: CaptionFont[] = [SYSTEM_CAPTION_FONT, ...BUNDLED_FONTS]

/**
 * The Local Font Access API, declared here because TypeScript's DOM library
 * does not carry it. Only the one field this needs is declared: a narrow local
 * declaration is easier to check against the spec than a wide guessed one.
 */
interface LocalFontData {
  family: string
}

interface FontAccessWindow {
  queryLocalFonts?: () => Promise<LocalFontData[]>
}

/** A family name as a CSS font-family value. Quoted, since names have spaces. */
function quote(family: string): string {
  return `"${family.replaceAll('"', '')}"`
}

/**
 * Every font installed on this machine, with the system default first.
 *
 * Chromium reports one entry per *face* — every weight and italic of a family
 * is its own row — so they are folded back to one entry per family. A caption
 * picker offers families; weight is a separate control.
 *
 * Falls back to the bundled list when the API is missing or the permission was
 * refused. That fallback is not an error state: a shorter list of fonts is a
 * working picker, and there is nothing the user could usefully do about it.
 */
export async function loadCaptionFonts(): Promise<CaptionFont[]> {
  const query = (window as unknown as FontAccessWindow).queryLocalFonts
  if (!query) return FALLBACK_CAPTION_FONTS

  try {
    const families = [...new Set((await query()).map((font) => font.family))].sort((a, b) =>
      a.localeCompare(b)
    )
    if (families.length === 0) return FALLBACK_CAPTION_FONTS
    return [
      SYSTEM_CAPTION_FONT,
      ...families.map((family) => ({
        value: family,
        label: family,
        // The system stack trails every choice: a font without glyphs for this
        // language would otherwise fall back to whatever the browser picks,
        // which for CJK is frequently not a CJK face at all.
        stack: `${quote(family)}, ${SYSTEM_CAPTION_FONT.stack}`
      }))
    ]
  } catch {
    return FALLBACK_CAPTION_FONTS
  }
}

/**
 * The stack to render a stored value with.
 *
 * Takes the loaded list so a family that is installed renders as itself, and
 * falls back to naming the family directly — a project may carry a font this
 * machine does not have, and the value is still the best thing to ask CSS for.
 */
export function captionFontStack(value: string, fonts: CaptionFont[]): string {
  const known = fonts.find((font) => font.value === value)
  if (known) return known.stack
  if (value === SYSTEM_FONT) return SYSTEM_CAPTION_FONT.stack
  return `${quote(value)}, ${SYSTEM_CAPTION_FONT.stack}`
}
