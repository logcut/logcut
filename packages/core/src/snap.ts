/**
 * How near the pointer has to come before a drag is pulled onto a landmark,
 * **in screen pixels**.
 *
 * It is a distance the hand can hold, so it is quoted where the hand is — on
 * screen — and every caller converts it into whatever it is dragging: the
 * timeline divides by its scale to get milliseconds, the caption overlay by
 * the picture's size to get a share of it. One number, because two would drift
 * and a drag would then feel different depending on what was being dragged.
 */
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
