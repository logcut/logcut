import assert from 'node:assert/strict'
import { test } from 'node:test'
import { segmentTranscript, segmentUtterance } from './segment.ts'
import type { Utterance, Word } from './types.ts'

/** Build words for a string: one Word per non-punctuation token, 200ms each. */
function words(tokens: string[], startEach = 200): Word[] {
  return tokens.map((word, i) => ({
    word,
    start: word.trim() === '' ? -1 : i * startEach,
    end: word.trim() === '' ? -1 : i * startEach + 150,
    suspect: false
  }))
}

function utterance(text: string, tokens: string[]): Utterance {
  return { id: 'u', start: 0, end: tokens.length * 200, text, words: words(tokens) }
}

test('cuts on sentence and clause punctuation', () => {
  const u = utterance(
    '你好，世界。再见了',
    ['你', '好', '世', '界', '再', '见', '了']
  )
  const out = segmentUtterance(u, { minChars: 2 })
  assert.deepEqual(
    out.map((s) => s.text),
    ['你好，', '世界。', '再见了']
  )
})

test('joined line texts reconstruct the original minus trimming', () => {
  const u = utterance(
    '今天天气很好，我们出去玩吧。',
    ['今', '天', '天', '气', '很', '好', '我', '们', '出', '去', '玩', '吧']
  )
  const joined = segmentUtterance(u, { maxChars: 6, minChars: 3 })
    .map((s) => s.text)
    .join('')
  assert.equal(joined, '今天天气很好，我们出去玩吧。')
})

test('never splits a latin word across lines', () => {
  // "Model S Model 3" as ASR tokens: word, spacer, word, spacer, word, "3"
  const u = utterance('Model S Model 3', ['Model', ' ', 'S', ' ', 'Model', ' ', '3'])
  const out = segmentUtterance(u, { maxChars: 6, minChars: 2, hardMaxChars: 8 })
  for (const line of out) {
    // No line ends with a partial latin word like "Mode".
    assert.ok(!/Mode$/.test(line.text), `split a word: ${line.text}`)
    assert.ok(!/Mod$/.test(line.text), `split a word: ${line.text}`)
  }
  assert.equal(out.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(), 'Model S Model 3')
})

test('empty words returns the utterance unchanged', () => {
  const u: Utterance = { id: 'u', start: 0, end: 1000, text: 'no words', words: [] }
  assert.deepEqual(segmentUtterance(u), [u])
})

test('line start/end come from real word times, skipping leading spacer', () => {
  const u = utterance('AI 你好。', ['AI', ' ', '你', '好'])
  // High minGap so the spacer pause does not split; isolate the start/end logic.
  const [line] = segmentUtterance(u, { minChars: 2, minGapMs: 9999 })
  assert.equal(line.start, 0) // 'AI' at index 0
  assert.equal(line.end, 3 * 200 + 150) // '好' at index 3
  assert.ok(line.words.length > 0)
})

test('segmentTranscript flattens all utterances and preserves speaker', () => {
  const t = {
    sourcePath: '/x.mp4',
    audioDurationMs: 5000,
    utterances: [
      { ...utterance('你好，世界。', ['你', '好', '世', '界']), speakerId: '1' }
    ]
  }
  const out = segmentTranscript(t, { minChars: 2 })
  assert.equal(out.utterances.length, 2)
  assert.ok(out.utterances.every((u) => u.speakerId === '1'))
  assert.equal(out.sourcePath, '/x.mp4')
})
