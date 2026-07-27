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

/**
 * Tick marks in `[fromMs, toMs]`, aligned to whole multiples of `interval`.
 *
 * A range rather than "from zero to the end" because the ruler only ever draws
 * the visible window: zoomed all the way in that is a few dozen labels out of
 * tens of thousands, and the range keeps the loop proportional to what is
 * drawn. It also lets the ruler run past the media, which is what fills the
 * empty track to the right once the view is zoomed out below fit-to-width.
 */
export function tickTimes(fromMs: number, toMs: number, interval: number): number[] {
  if (interval <= 0 || toMs < fromMs) return []
  const times: number[] = []
  const first = Math.max(0, Math.floor(fromMs / interval))
  const last = Math.floor(toMs / interval)
  for (let index = first; index <= last; index += 1) times.push(index * interval)
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
 *
 * The comparison is against where the previous block **is drawn**, not where
 * it ends in time. Those differ: a line narrower than `minBlockPx` is widened
 * so it stays visible at all, and that widening reaches past the next line's
 * start. Comparing against the time made short neighbours fail the merge test
 * and then overlap on screen — blocks that ran into each other zoomed out and
 * came apart, with room to spare, zoomed in.
 */
export function mergeBlocks(
  utterances: Utterance[],
  scale: number,
  activeId: string | null,
  minBlockPx = 4,
  minGapPx = 1
): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = []
  for (const utterance of utterances) {
    const last = blocks[blocks.length - 1]
    const isActive = utterance.id === activeId
    const drawnEndMs = last
      ? last.startMs + Math.max(last.endMs - last.startMs, minBlockPx / scale)
      : 0
    if (last && (utterance.start - drawnEndMs) * scale < minGapPx) {
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
