import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  replaceAllText,
  setUtteranceText
} from './transcript.ts'
import type { Transcript, Utterance } from './types.ts'

function fixture(): Transcript {
  return {
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

function gapped(): Utterance[] {
  // Deliberately not contiguous: real transcripts have silence between
  // utterances, and a time landing there has no active utterance.
  return [
    { id: 'a', start: 0, end: 400, text: 'a', words: [] },
    { id: 'b', start: 1000, end: 1500, text: 'b', words: [] },
    { id: 'c', start: 1500, end: 2000, text: 'c', words: [] }
  ]
}

test('findUtteranceIndexAt finds the covering utterance', () => {
  const utterances = gapped()
  assert.equal(findUtteranceIndexAt(utterances, 0), 0)
  assert.equal(findUtteranceIndexAt(utterances, 399), 0)
  assert.equal(findUtteranceIndexAt(utterances, 1200), 1)
  assert.equal(findUtteranceIndexAt(utterances, 1999), 2)
})

test('findUtteranceIndexAt treats end as exclusive', () => {
  const utterances = gapped()
  // 1500 is b.end and c.start: it belongs to c, not b.
  assert.equal(findUtteranceIndexAt(utterances, 1500), 2)
  // 400 is a.end with nothing starting there, so it is a gap.
  assert.equal(findUtteranceIndexAt(utterances, 400), -1)
})

test('findUtteranceIndexAt returns -1 in gaps and out of range', () => {
  const utterances = gapped()
  assert.equal(findUtteranceIndexAt(utterances, 700), -1)
  assert.equal(findUtteranceIndexAt(utterances, -1), -1)
  assert.equal(findUtteranceIndexAt(utterances, 2000), -1)
  assert.equal(findUtteranceIndexAt(utterances, 99999), -1)
})

test('findUtteranceIndexAt handles an empty transcript', () => {
  assert.equal(findUtteranceIndexAt([], 0), -1)
})

test('findNearestUtteranceIndex still prefers a covering utterance', () => {
  const utterances = gapped()
  assert.equal(findNearestUtteranceIndex(utterances, 0), 0)
  assert.equal(findNearestUtteranceIndex(utterances, 1200), 1)
  assert.equal(findNearestUtteranceIndex(utterances, 1500), 2)
})

test('findNearestUtteranceIndex resolves a gap to the closer side', () => {
  const utterances = gapped()
  // The gap runs 400..1000. 500 is nearer a, 900 nearer b.
  assert.equal(findNearestUtteranceIndex(utterances, 500), 0)
  assert.equal(findNearestUtteranceIndex(utterances, 900), 1)
  // Dead centre goes to the earlier line.
  assert.equal(findNearestUtteranceIndex(utterances, 700), 0)
})

test('findNearestUtteranceIndex clamps to the ends', () => {
  const utterances = gapped()
  assert.equal(findNearestUtteranceIndex(utterances, -5000), 0)
  assert.equal(findNearestUtteranceIndex(utterances, 2000), 2)
  assert.equal(findNearestUtteranceIndex(utterances, 99999), 2)
})

test('findNearestUtteranceIndex only returns -1 for an empty transcript', () => {
  assert.equal(findNearestUtteranceIndex([], 0), -1)
})

test('findUtteranceIndexAt agrees with a linear scan', () => {
  const utterances = gapped()
  for (let t = -50; t <= 2100; t += 1) {
    const expected = utterances.findIndex((u) => t >= u.start && t < u.end)
    assert.equal(findUtteranceIndexAt(utterances, t), expected, `mismatch at ${t}ms`)
  }
})
