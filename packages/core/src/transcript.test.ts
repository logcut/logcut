import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replaceAllText, setUtteranceText } from './transcript.ts'
import type { Transcript } from './types.ts'

function fixture(): Transcript {
  return {
    sourcePath: '/tmp/a.mp4',
    audioDurationMs: 1000,
    utterances: [
      { id: 'a', start: 0, end: 400, text: 'AI 卷子来了', words: [] },
      { id: 'b', start: 400, end: 800, text: '卷子卷子不是 Agent', words: [] },
      { id: 'c', start: 800, end: 1000, text: '没有匹配', words: [] }
    ]
  }
}

test('setUtteranceText replaces only the target utterance', () => {
  const result = setUtteranceText(fixture(), 'b', '改好了')
  assert.equal(result.utterances[1].text, '改好了')
  assert.equal(result.utterances[0].text, 'AI 卷子来了')
  assert.equal(result.utterances[2].text, '没有匹配')
})

test('replaceAllText counts occurrences across utterances', () => {
  const { transcript, count } = replaceAllText(fixture(), '卷子', 'Agent')
  assert.equal(count, 3)
  assert.equal(transcript.utterances[0].text, 'AI Agent来了')
  assert.equal(transcript.utterances[1].text, 'AgentAgent不是 Agent')
  assert.equal(transcript.utterances[2].text, '没有匹配')
})

test('replaceAllText with no match returns the same transcript and zero count', () => {
  const original = fixture()
  const { transcript, count } = replaceAllText(original, '不存在的词', 'x')
  assert.equal(count, 0)
  assert.equal(transcript, original)
})

test('replaceAllText with empty find is a no-op', () => {
  const original = fixture()
  const { transcript, count } = replaceAllText(original, '', 'x')
  assert.equal(count, 0)
  assert.equal(transcript, original)
})
