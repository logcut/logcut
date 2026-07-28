import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseVolcanoResponse } from './volcano.ts'

const response = {
  audio_info: { duration: 40_000 },
  result: {
    utterances: [
      {
        text: '你好，世界。',
        start_time: 200,
        end_time: 1400,
        additions: { speaker: '2' },
        words: [
          { text: '你好', start_time: 200, end_time: 800 },
          { text: '世界', start_time: 900, end_time: 1400 }
        ]
      }
    ]
  }
}

test('maps utterances, words, speaker and duration', () => {
  const transcript = parseVolcanoResponse(response)
  assert.equal(transcript.audioDurationMs, 40_000)
  assert.equal(transcript.utterances.length, 1)

  const [utterance] = transcript.utterances
  assert.equal(utterance.text, '你好，世界。')
  assert.equal(utterance.start, 200)
  assert.equal(utterance.end, 1400)
  assert.equal(utterance.speakerId, '2')
  assert.deepEqual(
    utterance.words.map((word) => word.word),
    ['你好', '世界']
  )
  assert.ok(utterance.words.every((word) => word.suspect === false))
})

test('mints a fresh id per utterance', () => {
  const [first] = parseVolcanoResponse(response).utterances
  const [second] = parseVolcanoResponse(response).utterances
  assert.notEqual(first.id, second.id)
})

// Everything below is the archived-file case: this parser is re-run months
// later over whatever the service wrote that day, so a missing or wrong-typed
// field has to degrade rather than throw.
test('survives an empty or absent result', () => {
  assert.deepEqual(parseVolcanoResponse({}), { audioDurationMs: 0, utterances: [] })
  assert.deepEqual(parseVolcanoResponse({ result: {} }), { audioDurationMs: 0, utterances: [] })
})

test('survives null, a primitive, and a non-array utterance list', () => {
  for (const input of [null, undefined, 42, 'nope', { result: { utterances: 'nope' } }]) {
    assert.deepEqual(parseVolcanoResponse(input), { audioDurationMs: 0, utterances: [] })
  }
})

test('fills in defaults for missing utterance and word fields', () => {
  const transcript = parseVolcanoResponse({
    result: { utterances: [{ text: '孤零零' }, {}] }
  })
  assert.equal(transcript.utterances.length, 2)

  const [withText, empty] = transcript.utterances
  assert.equal(withText.text, '孤零零')
  assert.equal(withText.start, 0)
  assert.deepEqual(withText.words, [])
  assert.equal(withText.speakerId, undefined)
  assert.equal(empty.text, '')
})

test('drops a speaker that is not a string', () => {
  const transcript = parseVolcanoResponse({
    result: { utterances: [{ text: 'x', additions: { speaker: 7 } }] }
  })
  assert.equal(transcript.utterances[0].speakerId, undefined)
})
