import type { CaptionStyle, CaptionStyles, Utterance } from '@logcut/core'

/** Where an Apply pushes a line's look. **Two cases, not three** — the line
 *  itself is not a target, because that is where every edit already lands (see
 *  caption-apply.md). */
export type CaptionApplyTarget = { kind: 'all' } | { kind: 'speaker'; speakerId: string }

/** The lines an Apply would overwrite: the ones carrying styling of their own,
 *  which outranks whatever layer the Apply writes to and would otherwise leave
 *  the promise "all subtitles" visibly untrue. Also the ids
 *  `subtitle.clearStyle` needs, so the answer is computed once and used twice. */
export function linesWithOwnStyle<T extends Utterance>(
  utterances: T[],
  target: CaptionApplyTarget
): T[] {
  return utterances.filter(
    (utterance) =>
      utterance.style !== undefined &&
      (target.kind === 'all' || utterance.speakerId === target.speakerId)
  )
}

/** Speakers carrying an override of their own. **Only ever asked about an Apply
 *  to all subtitles**: applying to one speaker writes that speaker's own layer,
 *  so there is nobody else's to overwrite. */
export function speakersWithOwnStyle(styles: CaptionStyles): string[] {
  return Object.entries(styles.bySpeaker)
    .filter(([, override]) => Object.keys(override).length > 0)
    .map(([speakerId]) => speakerId)
}

/** The project's styling after an Apply. **The whole resolved style goes in, not
 *  the fields that were touched** — the target is being told to look like this
 *  line, and a patch would leave it inheriting the rest from wherever it did
 *  before. */
export function captionStylesAfterApply(
  styles: CaptionStyles,
  target: CaptionApplyTarget,
  style: CaptionStyle,
  /** Whether the narrower layers are being cleared along with it. The per-line
   *  ones travel as a command; the per-speaker ones are in this file. */
  overwrite: boolean
): CaptionStyles {
  if (target.kind === 'speaker') {
    return { ...styles, bySpeaker: { ...styles.bySpeaker, [target.speakerId]: style } }
  }
  return { base: style, bySpeaker: overwrite ? {} : styles.bySpeaker }
}
