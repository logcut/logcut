import { randomId } from './id.ts'
import type { Transcript, Utterance, Word } from './types.ts'

/**
 * The provider's response shape, as much of it as we read. Everything is
 * optional because this parser also runs over a response read back from disk
 * months later — the archived file is whatever the service returned that day,
 * not a shape the compiler ever checked.
 */
interface VolcanoWord {
  text?: unknown
  start_time?: unknown
  end_time?: unknown
}

interface VolcanoUtterance {
  text?: unknown
  start_time?: unknown
  end_time?: unknown
  additions?: { speaker?: unknown }
  words?: unknown
}

interface VolcanoResponse {
  audio_info?: { duration?: unknown }
  result?: { utterances?: unknown }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asMs = (value: unknown): number => (typeof value === 'number' ? value : 0)
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

function toWord(value: unknown): Word {
  const raw = (isObject(value) ? value : {}) as VolcanoWord
  return {
    word: asText(raw.text),
    start: asMs(raw.start_time),
    end: asMs(raw.end_time),
    // The provider's own confidence field is always 0 and unusable; this is
    // set by LLM post-processing in a later milestone.
    suspect: false
  }
}

function toUtterance(value: unknown): Utterance {
  const raw = (isObject(value) ? value : {}) as VolcanoUtterance
  const speaker = raw.additions?.speaker
  return {
    id: randomId(),
    start: asMs(raw.start_time),
    end: asMs(raw.end_time),
    text: asText(raw.text),
    speakerId: typeof speaker === 'string' ? speaker : undefined,
    words: Array.isArray(raw.words) ? raw.words.map(toWord) : []
  }
}

/**
 * Turn a Volcano Engine ASR response into a transcript.
 *
 * **In the core, not beside the HTTP call**, because the second caller is an
 * archived response read back off disk when the line length changes —
 * re-splitting must not need the network.
 *
 * Ids are minted here: the provider has no stable id to carry over.
 */
export function parseVolcanoResponse(response: unknown): Transcript {
  const body = (isObject(response) ? response : {}) as VolcanoResponse
  const utterances = body.result?.utterances
  return {
    audioDurationMs: asMs(body.audio_info?.duration),
    utterances: Array.isArray(utterances) ? utterances.map(toUtterance) : []
  }
}
