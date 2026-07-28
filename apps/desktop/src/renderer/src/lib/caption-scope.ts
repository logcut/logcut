import { resolveCaptionStyle } from '@logcut/core'
import type { CaptionStyle, CaptionStyles, Utterance } from '@logcut/core'

/** Which subtitles the style panel is talking about — the three cases are the
 *  three storage layers (see packages/core/src/caption-style.ts). */
export type CaptionScope =
  { kind: 'all' } | { kind: 'speaker'; speakerId: string } | { kind: 'line' }

/** What the controls should show for a scope: always the **resolved** value,
 *  never the raw override (see caption-scope.md). */
export function styleForScope(
  styles: CaptionStyles,
  scope: CaptionScope,
  line: Utterance | null
): CaptionStyle {
  if (scope.kind === 'speaker') return resolveCaptionStyle(styles, { speakerId: scope.speakerId })
  if (scope.kind === 'line' && line) {
    return resolveCaptionStyle(styles, { speakerId: line.speakerId, style: line.style })
  }
  return resolveCaptionStyle(styles)
}

/** A scope that no longer exists falls back to the whole project — both narrow
 *  scopes can vanish under the panel (see caption-scope.md). */
export function liveScope(
  scope: CaptionScope,
  speakerIds: string[],
  hasSelection: boolean
): CaptionScope {
  if (scope.kind === 'line' && !hasSelection) return { kind: 'all' }
  if (scope.kind === 'speaker' && !speakerIds.includes(scope.speakerId)) return { kind: 'all' }
  return scope
}
