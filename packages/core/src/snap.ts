/**
 * Pull a dragged time onto a nearby landmark.
 *
 * Editing on a timeline is mostly about making two things line up exactly, and
 * a pointer cannot land on an exact millisecond — at a typical zoom one pixel
 * is tens of them. Snapping is what makes "put this edge where the playhead is"
 * a gesture rather than a numeric entry.
 *
 * The tolerance is in **milliseconds**, and the caller converts it from a pixel
 * distance at the current zoom: a snap that felt right zoomed out would be
 * unusable zoomed in, where the same tolerance covers a whole word.
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
 * Every edge a line offers as a landmark.
 *
 * Both ends of every line, deduplicated: lines that touch share an edge, and
 * offering it twice would make no difference to the result but does make the
 * candidate list twice as long on a transcript of a thousand lines.
 *
 * `exclude` drops the line being dragged. Without it an edge snaps to itself
 * the instant the drag begins, and the other end of the same line pulls it into
 * a zero-length subtitle.
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
