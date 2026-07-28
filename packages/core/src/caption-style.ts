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
export interface CaptionStyle {
  /**
   * A family name for CSS and, later, for the burn-in filter. The sentinel
   * `SYSTEM_FONT` means the platform's own UI font — the only choice certain to
   * have glyphs for whatever language the transcript is in.
   */
  fontFamily: string
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
  fontFamily: SYSTEM_FONT
}

export const DEFAULT_CAPTION_STYLES: CaptionStyles = {
  base: DEFAULT_CAPTION_STYLE,
  bySpeaker: {}
}

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

/**
 * Fill in whatever a stored value is missing.
 *
 * Every field of every scope is optional on disk, and a project written before
 * a field existed has to keep opening. Exporting to another editor's project
 * format later means walking these values with no chance to ask the user what
 * a missing one meant.
 */
export function normalizeCaptionStyles(stored: unknown): CaptionStyles {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<{
    base: unknown
    bySpeaker: unknown
  }>
  const base = (typeof value.base === 'object' && value.base !== null ? value.base : {}) as Partial<
    Record<keyof CaptionStyle, unknown>
  >
  const bySpeaker =
    typeof value.bySpeaker === 'object' && value.bySpeaker !== null
      ? (value.bySpeaker as Record<string, unknown>)
      : {}

  const partial = (input: unknown): Partial<CaptionStyle> => {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<
      Record<keyof CaptionStyle, unknown>
    >
    return typeof raw.fontFamily === 'string' ? { fontFamily: raw.fontFamily } : {}
  }

  return {
    base: {
      fontFamily:
        typeof base.fontFamily === 'string' ? base.fontFamily : DEFAULT_CAPTION_STYLE.fontFamily
    },
    bySpeaker: Object.fromEntries(
      Object.entries(bySpeaker).map(([speakerId, override]) => [speakerId, partial(override)])
    )
  }
}
