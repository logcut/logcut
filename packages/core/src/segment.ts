import { randomId } from './id.ts'
import type { Transcript, Utterance, Word } from './types.ts'

export interface SegmentOptions {
  /** Soft cap; cut at a safe boundary once a line reaches this many chars. */
  maxChars?: number
  /** Do not cut on a comma/pause before a line has at least this many chars. */
  minChars?: number
  /** Cut when the pause to the next word is at least this long (ms). */
  minGapMs?: number
  /** Hard cap: cut even mid latin-run once a line reaches this, to bound pure-latin text. */
  hardMaxChars?: number
}

export const DEFAULT_MAX_CHARS = 20

const DEFAULTS: Required<SegmentOptions> = {
  maxChars: DEFAULT_MAX_CHARS,
  minChars: 6,
  minGapMs: 250,
  hardMaxChars: 40
}

/**
 * The floor that goes with a given ceiling, when the caller sets only the
 * ceiling. `minChars` gates the comma and pause rules, so it has to stay below
 * `maxChars` — at or above it, both rules can never fire and line length is
 * left to the full-stop and the hard cap alone. Deriving it means the one
 * setting a user is given cannot be turned into that contradiction: 20 keeps
 * the tuned 6, and a ceiling of 8 brings the floor down to 2 with it.
 */
export function minCharsFor(maxChars: number): number {
  // Clamped below the ceiling rather than merely scaled: at a ceiling of 2 the
  // proportion alone would land on the ceiling itself and reintroduce exactly
  // the contradiction this exists to prevent.
  return Math.max(1, Math.min(maxChars - 1, Math.round(maxChars * 0.3)))
}

const END_PUNC = /[。！？.!?]$/
const MID_PUNC = /[，,、；;：:]$/
const isSpace = (w: string): boolean => w.trim() === ''
const isWordChar = (w: string): boolean => /^[A-Za-z0-9]/.test(w)

interface Piece {
  word: Word
  /** This word's slice of utterance.text, including any trailing punctuation. */
  text: string
  /** Effective time for gap math; spacer tokens (start<0) borrow from neighbors. */
  effStart: number
  effEnd: number
}

/**
 * Distribute utterance.text back onto its words. The ASR returns words without
 * punctuation, so text has extra chars — a two-pointer walk assigns each text
 * char to the current word and hangs punctuation onto the preceding word.
 */
function align(u: Utterance): Piece[] {
  const pieces: Piece[] = u.words.map((word) => ({
    word,
    text: '',
    effStart: word.start,
    effEnd: word.end
  }))
  let wi = 0
  let ci = 0
  for (const ch of u.text) {
    while (wi < pieces.length && ci >= pieces[wi].word.word.length) {
      wi++
      ci = 0
    }
    if (wi < pieces.length && pieces[wi].word.word[ci] === ch) {
      pieces[wi].text += ch
      ci++
    } else if (wi > 0) {
      pieces[wi - 1].text += ch
    } else if (wi < pieces.length) {
      pieces[wi].text += ch
    }
  }
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].effStart < 0) {
      pieces[i].effStart = i > 0 ? pieces[i - 1].effEnd : 0
      pieces[i].effEnd = pieces[i].effStart
    }
  }
  return pieces
}

function buildUtterance(group: Piece[], speakerId?: string): Utterance {
  const timed = group.filter((p) => p.word.start >= 0)
  return {
    id: randomId(),
    start: timed.length ? timed[0].word.start : group[0].effStart,
    end: timed.length ? timed[timed.length - 1].word.end : group[group.length - 1].effEnd,
    text: group
      .map((p) => p.text)
      .join('')
      .trim(),
    speakerId,
    // Words are the timestamp anchors and stay verbatim (spacers keep start=-1).
    words: group.map((p) => p.word)
  }
}

/** Split one utterance into subtitle-length lines using its word timestamps. */
export function segmentUtterance(u: Utterance, options: SegmentOptions = {}): Utterance[] {
  const { maxChars, minGapMs, hardMaxChars } = { ...DEFAULTS, ...options }
  // An explicit floor still wins; the derived one only covers the common case
  // of a caller that set the ceiling and nothing else.
  const minChars = options.minChars ?? minCharsFor(maxChars)
  const pieces = align(u)
  if (pieces.length === 0) return [u]

  const result: Utterance[] = []
  let cur: Piece[] = []
  const flush = (): void => {
    if (cur.length === 0) return
    if (
      cur
        .map((p) => p.text)
        .join('')
        .trim() !== ''
    )
      result.push(buildUtterance(cur, u.speakerId))
    cur = []
  }

  for (let i = 0; i < pieces.length; i++) {
    cur.push(pieces[i])
    const len = [
      ...cur
        .map((p) => p.text)
        .join('')
        .trim()
    ].length
    const next = pieces[i + 1]
    const gap = next ? next.effStart - pieces[i].effEnd : 0
    const word = pieces[i].word.word
    // At the soft cap, only cut at a space or CJK boundary so a latin word is
    // never split; the hard cap forces a cut in an unbroken latin run.
    const atSafeBoundary = isSpace(word) || !isWordChar(word)
    if (END_PUNC.test(pieces[i].text)) {
      flush()
    } else if (MID_PUNC.test(pieces[i].text) && len >= minChars) {
      flush()
    } else if (len >= minChars && gap >= minGapMs) {
      flush()
    } else if (len >= maxChars && (atSafeBoundary || len >= hardMaxChars)) {
      flush()
    }
  }
  flush()
  return result.length > 0 ? result : [u]
}

/** Re-segment every utterance into subtitle-length lines. */
export function segmentTranscript(transcript: Transcript, options?: SegmentOptions): Transcript {
  return {
    ...transcript,
    utterances: transcript.utterances.flatMap((u) => segmentUtterance(u, options))
  }
}
