import type { Utterance } from '@logcut/core'

/** Geometry for the read-only timeline; see lib/timeline.md. */

/** Round numbers a viewer can read off a ruler, coarsest last. */
const TICK_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  1_800_000
]

/** Measured against the whole strip, which is not the window it is seen through. */
export function pxPerMs(stripWidth: number, totalMs: number): number {
  return totalMs > 0 ? stripWidth / totalMs : 0
}

/** Coarsest-but-one step whose labels still clear `minLabelPx` of each other. */
export function pickTickInterval(scale: number, minLabelPx = 72): number {
  for (const step of TICK_STEPS_MS) {
    if (step * scale >= minLabelPx) return step
  }
  return TICK_STEPS_MS[TICK_STEPS_MS.length - 1] as number
}

/** Tick marks in `[fromMs, toMs]`, aligned to whole multiples of `interval`.
 *  **A range rather than "zero to the end"**: it keeps the loop proportional to
 *  what is drawn, and lets the ruler run past the media (see lib/timeline.md). */
export function tickTimes(fromMs: number, toMs: number, interval: number): number[] {
  if (interval <= 0 || toMs < fromMs) return []
  const times: number[] = []
  const first = Math.max(0, Math.floor(fromMs / interval))
  const last = Math.floor(toMs / interval)
  for (let index = first; index <= last; index += 1) times.push(index * interval)
  return times
}

export interface SubtitleBlock {
  /** The line this block is; blocks and lines are one to one. */
  id: string
  /** Geometry along the strip, in pixels, ready to position with. */
  leftPx: number
  widthPx: number
  text: string
}

/**
 * One block per line, laid out along the strip.
 *
 * **Lines are never folded together, and blocks only ever get narrower.**
 * Overlap is prevented by clamping rather than by merging or widening, so
 * `minPx` is a floor the clamp is allowed to beat — see lib/timeline.md.
 *
 * Only what falls inside `[visibleFromPx, visibleToPx]` is built; the list is
 * sorted, so the scan stops at the first line past the window.
 */
export function subtitleBlocks(
  utterances: Utterance[],
  scale: number,
  visibleFromPx: number,
  visibleToPx: number,
  minPx = 1,
  gapPx = 1
): SubtitleBlock[] {
  if (scale <= 0) return []
  const blocks: SubtitleBlock[] = []
  for (let index = 0; index < utterances.length; index += 1) {
    const utterance = utterances[index] as Utterance
    const leftPx = utterance.start * scale
    if (leftPx > visibleToPx) break
    const naturalPx = (utterance.end - utterance.start) * scale
    if (leftPx + naturalPx < visibleFromPx) continue
    const next = utterances[index + 1]
    const roomPx = next ? next.start * scale - leftPx - gapPx : Number.POSITIVE_INFINITY
    blocks.push({
      id: utterance.id,
      leftPx,
      widthPx: Math.max(minPx, Math.min(naturalPx, roomPx)),
      text: utterance.text
    })
  }
  return blocks
}

/**
 * An utterance moved onto the timeline's clock.
 *
 * `id` is scoped to the clip, because the same asset can be laid down twice
 * and its transcript would otherwise contribute the same id at two different
 * times. `sourceId` is what the transcript itself calls the line, and is what
 * an edit has to be addressed by.
 */
export interface TimelineUtterance extends Utterance {
  clipId: string
  assetId: string
  sourceId: string
}

/**
 * Every clip's subtitles, shifted to where that clip sits and concatenated.
 *
 * The result reads exactly like one transcript, so everything downstream —
 * the binary searches, the block merging, the highlight — stays unaware that
 * the timeline is made of pieces.
 */
export function layUtterances(
  clips: { id: string; assetId: string; startMs: number }[],
  transcripts: Record<string, { utterances: Utterance[] } | null>
): TimelineUtterance[] {
  const laid: TimelineUtterance[] = []
  for (const clip of clips) {
    for (const utterance of transcripts[clip.assetId]?.utterances ?? []) {
      laid.push({
        ...utterance,
        id: `${clip.id}:${utterance.id}`,
        start: utterance.start + clip.startMs,
        end: utterance.end + clip.startMs,
        clipId: clip.id,
        assetId: clip.assetId,
        sourceId: utterance.id
      })
    }
  }
  return laid
}
