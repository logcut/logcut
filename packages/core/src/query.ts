import type { EditDocument } from './commands/index.ts'
import type { Transcript, Utterance } from './types.ts'

/**
 * Reading the document, for callers that cannot hold it.
 *
 * Not for the editor, which renders straight from the transcripts. This is
 * for a reader with a context budget — see query.md.
 */

/** One line, flattened to what a reader outside the editor needs. */
export interface UtteranceView {
  assetId: string
  id: string
  startMs: number
  endMs: number
  text: string
  speakerId?: string
}

export interface UtteranceQuery {
  /** Only this asset's subtitles. Every asset in the document by default. */
  assetId?: string
  /** Lines overlapping this window, on the transcript's own clock. */
  fromMs?: number
  toMs?: number
  /** Case-insensitive substring of the line's text. No regex semantics. */
  search?: string
  /** Skip this many matches — the page before this one. */
  offset?: number
  /** At most this many lines back. */
  limit?: number
}

export interface UtteranceQueryResult {
  lines: UtteranceView[]
  /**
   * Matches before paging. The point of reporting it separately is that a
   * reader must be able to tell "these are all of them" from "these are the
   * first twenty of four hundred" — a truncated answer that looks complete is
   * how a search-and-replace ends up applied to a fifth of the transcript.
   */
  total: number
}

/** Enough that a page is worth sending, few enough that it stays readable. */
export const DEFAULT_QUERY_LIMIT = 50

export function queryUtterances(
  doc: EditDocument,
  query: UtteranceQuery = {}
): UtteranceQueryResult {
  const { assetId, fromMs, toMs, search, offset = 0, limit = DEFAULT_QUERY_LIMIT } = query
  const needle = search === undefined ? null : search.toLowerCase()

  const entries: [string, Transcript][] =
    assetId === undefined
      ? Object.entries(doc.transcripts)
      : doc.transcripts[assetId]
        ? [[assetId, doc.transcripts[assetId]]]
        : []

  const matches: UtteranceView[] = []
  for (const [id, transcript] of entries) {
    for (const utterance of transcript.utterances) {
      if (!overlaps(utterance, fromMs, toMs)) continue
      if (needle !== null && !utterance.text.toLowerCase().includes(needle)) continue
      matches.push(viewOf(id, utterance))
    }
  }

  // Across assets the order is by asset then by time, which is the order the
  // transcripts are stored in; within one asset it is already chronological.
  return { lines: matches.slice(offset, offset + limit), total: matches.length }
}

/**
 * A window selects every line it touches, not only the ones wholly inside it.
 * Someone asking about 3:00–3:30 means the sentence running across 3:00 too —
 * dropping it would answer "nothing was said" about a moment being spoken over.
 */
function overlaps(utterance: Utterance, fromMs?: number, toMs?: number): boolean {
  if (fromMs !== undefined && utterance.end <= fromMs) return false
  if (toMs !== undefined && utterance.start >= toMs) return false
  return true
}

function viewOf(assetId: string, utterance: Utterance): UtteranceView {
  return {
    assetId,
    id: utterance.id,
    startMs: utterance.start,
    endMs: utterance.end,
    text: utterance.text,
    ...(utterance.speakerId === undefined ? {} : { speakerId: utterance.speakerId })
  }
}
