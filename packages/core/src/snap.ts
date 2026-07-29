/** How near the pointer has to come before a drag is pulled onto a landmark,
 *  **in screen pixels** — a distance the hand can hold, quoted where the hand
 *  is. **One number for every caller**, or a drag would feel different
 *  depending on what was being dragged (see snap.md). */
export const SNAP_TOLERANCE_PX = 8

/**
 * Pull a dragged value onto a nearby landmark (see snap.md).
 *
 * **The tolerance is in the value's own units and the caller converts it from
 * `SNAP_TOLERANCE_PX`.** A tolerance that felt right zoomed out covers a whole
 * word zoomed in.
 */
export function snapToNearest(value: number, candidates: number[], tolerance: number): number {
  if (tolerance <= 0) return value

  let best = value
  let bestDistance = tolerance
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value)
    // Strictly nearer, so that among equidistant candidates the first given
    // wins — the caller orders them by what should take precedence.
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * Every edge a line offers as a landmark, deduplicated.
 *
 * **`exclude` drops the line being dragged.** Without it an edge snaps to
 * itself the instant the drag begins, and the other end of the same line pulls
 * it into a zero-length subtitle.
 */
export function utteranceEdges(
  utterances: { id: string; start: number; end: number }[],
  exclude: readonly string[] = []
): number[] {
  const skip = new Set(exclude)
  const edges = new Set<number>()
  for (const utterance of utterances) {
    if (skip.has(utterance.id)) continue
    edges.add(utterance.start)
    edges.add(utterance.end)
  }
  return [...edges]
}
