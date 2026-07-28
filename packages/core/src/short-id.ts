/**
 * Ids are UUIDs, which is right for storage and wrong for a conversation: a
 * model has to quote one back, and at 36 characters that is expensive both ways
 * and unrecoverable if one character is wrong.
 *
 * **The two directions are deliberately separate functions.** Shortening is a
 * presentation decision made where output is produced; accepting a prefix is an
 * input decision made where commands are read. Neither implies the other.
 */

/**
 * Below this, a prefix stops being recognizable as an id and starts looking
 * like a word. Eight hex characters is also comfortably past the point where
 * two ids in one transcript collide by chance.
 */
export const SHORT_ID_FLOOR = 8

/**
 * The shortest prefix that identifies each id uniquely, never shorter than
 * `SHORT_ID_FLOOR`.
 *
 * Uniqueness is decided against **every id given**, so the map must be built
 * from the whole set the reader may see — not from one page of results. Build
 * it per page and the same line comes back as `a1b2c3d4` in one answer and
 * `a1b2c3d45` in the next, which reads as two different lines.
 *
 * Sorted once and compared only with neighbours: in sort order, the longest
 * prefix an id shares with anything is shared with the entry just before or
 * just after it, so this settles in one pass instead of comparing every pair.
 */
export function shortIdMap(ids: Iterable<string>, floor = SHORT_ID_FLOOR): Map<string, string> {
  const sorted = [...new Set(ids)].sort()
  const map = new Map<string, string>()

  for (let index = 0; index < sorted.length; index += 1) {
    const id = sorted[index]
    if (id === undefined) continue
    const shared = Math.max(
      commonPrefixLength(sorted[index - 1], id),
      commonPrefixLength(id, sorted[index + 1])
    )
    map.set(id, id.slice(0, Math.min(id.length, Math.max(floor, shared + 1))))
  }

  return map
}

function commonPrefixLength(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return 0
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}

/**
 * The full id a candidate names: itself when it is already one, otherwise the
 * single id it prefixes.
 *
 * `null` when nothing matches **and** when several do. An ambiguous prefix is
 * not a near miss to be resolved by picking the first one — that would edit an
 * arbitrary line and report success.
 *
 * An exact match wins without looking further, so a full id never becomes
 * ambiguous just because another id happens to start with it.
 */
export function resolveShortId(candidate: string, ids: Iterable<string>): string | null {
  if (candidate === '') return null
  let match: string | null = null

  for (const id of ids) {
    if (id === candidate) return id
    if (!id.startsWith(candidate)) continue
    if (match !== null) return null
    match = id
  }

  return match
}
