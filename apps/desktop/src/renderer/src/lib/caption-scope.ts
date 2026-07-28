import { resolveCaptionStyle } from '@logcut/core'
import type { CaptionStyle, CaptionStyles, Utterance } from '@logcut/core'

/**
 * Which subtitles the style panel is talking about.
 *
 * The three cases are the three storage layers (see
 * packages/core/src/caption-style.ts), so the panel offering a choice and the
 * document having somewhere to put it are the same fact stated twice.
 */
export type CaptionScope =
  { kind: 'all' } | { kind: 'speaker'; speakerId: string } | { kind: 'line' }

/**
 * What the controls should show for a scope.
 *
 * Always the **resolved** value, never the raw override: a speaker that sets
 * nothing still has to read as what its lines actually look like, or the panel
 * shows defaults for subtitles that are plainly not default on screen. What the
 * scope changes is where an edit goes, not what a control reads.
 */
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

/**
 * A scope that no longer exists falls back to the whole project.
 *
 * Both narrow scopes can vanish under the panel: the selected line is
 * deselected or deleted, and a speaker disappears when the last line assigned
 * to them is reassigned or removed. Leaving the panel pointed at either would
 * mean edits landing somewhere invisible.
 */
export function liveScope(
  scope: CaptionScope,
  speakerIds: string[],
  hasSelection: boolean
): CaptionScope {
  if (scope.kind === 'line' && !hasSelection) return { kind: 'all' }
  if (scope.kind === 'speaker' && !speakerIds.includes(scope.speakerId)) return { kind: 'all' }
  return scope
}
