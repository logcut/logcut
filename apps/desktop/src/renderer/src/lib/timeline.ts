import type { Utterance } from '@logcut/core'

/**
 * Geometry for the read-only timeline. The scale is fit-to-width — the whole
 * media always spans the container — which is what lets the timeline skip
 * horizontal scrolling, virtualization and a zoom level entirely.
 */

/** Round numbers a viewer can read off a ruler, coarsest last. */
const TICK_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  1_800_000
]

export function pxPerMs(containerWidth: number, totalMs: number): number {
  return totalMs > 0 ? containerWidth / totalMs : 0
}

/** Coarsest-but-one step whose labels still clear `minLabelPx` of each other. */
export function pickTickInterval(scale: number, minLabelPx = 72): number {
  for (const step of TICK_STEPS_MS) {
    if (step * scale >= minLabelPx) return step
  }
  return TICK_STEPS_MS[TICK_STEPS_MS.length - 1] as number
}

export function tickTimes(totalMs: number, interval: number): number[] {
  if (interval <= 0 || totalMs <= 0) return []
  const times: number[] = []
  for (let time = 0; time <= totalMs; time += interval) times.push(time)
  return times
}

export interface SubtitleBlock {
  startMs: number
  endMs: number
  /** How many utterances were folded in; 1 means the block is a single line. */
  count: number
  /** True when the currently playing utterance is inside this block. */
  active: boolean
}

/**
 * Merge utterances that would render closer together than `minGapPx`.
 *
 * An hour of speech is well over a thousand utterances, and at fit-to-width
 * most of them are under a pixel wide — rendering one node each would be
 * thousands of DOM nodes to draw a solid bar. Merging caps the node count at
 * roughly the container's pixel width.
 */
export function mergeBlocks(
  utterances: Utterance[],
  scale: number,
  activeId: string | null,
  minGapPx = 2
): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = []
  for (const utterance of utterances) {
    const last = blocks[blocks.length - 1]
    const isActive = utterance.id === activeId
    if (last && (utterance.start - last.endMs) * scale < minGapPx) {
      last.endMs = Math.max(last.endMs, utterance.end)
      last.count += 1
      last.active ||= isActive
    } else {
      blocks.push({
        startMs: utterance.start,
        endMs: utterance.end,
        count: 1,
        active: isActive
      })
    }
  }
  return blocks
}

/** Where each asset starts when they are laid end to end. */
export function mediaOffsets(durations: number[]): number[] {
  const offsets: number[] = []
  let total = 0
  for (const duration of durations) {
    offsets.push(total)
    total += duration
  }
  return offsets
}
