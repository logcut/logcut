/**
 * Pull a dragged time onto a nearby landmark (see snap.md).
 *
 * **The tolerance is in milliseconds and the caller converts it from a pixel
 * distance at the current zoom.** One that felt right zoomed out covers a
 * whole word zoomed in.
 */
export function snapTime(timeMs: number, candidates: number[], toleranceMs: number): number {
  if (toleranceMs <= 0) return timeMs

  let best = timeMs
  let bestDistance = toleranceMs
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - timeMs)
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
