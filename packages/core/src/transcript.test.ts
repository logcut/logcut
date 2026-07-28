import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampUtteranceTime,
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  insertUtteranceAfter,
  mergeUtterances,
  removeUtterances,
  nextSpeakerId,
  replaceAllText,
  setUtteranceSpeaker,
  setUtteranceText,
  setUtteranceTime,
  speakerIdsOf,
  setUtteranceStyle
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

test('mergeUtterances folds the next line in and spans both', () => {
  const source = fixture()
  const result = mergeUtterances(source, 'a')
  assert.equal(result.utterances.length, 2)
  assert.deepEqual(
    {
      id: result.utterances[0].id,
      start: result.utterances[0].start,
      end: result.utterances[0].end
    },
    { id: 'a', start: 0, end: 800 }
  )
  assert.equal(result.utterances[0].text, 'AI 卷子来了卷子卷子不是 Agent')
  assert.equal(result.utterances[1].id, 'c')
  // The original is untouched.
  assert.equal(source.utterances.length, 3)
})

test('mergeUtterances puts a space between Latin words only', () => {
  const latin: Transcript = {
    audioDurationMs: 1000,
    utterances: [
      { id: 'a', start: 0, end: 400, text: 'hello', words: [] },
      { id: 'b', start: 400, end: 800, text: 'world', words: [] }
    ]
  }
  assert.equal(mergeUtterances(latin, 'a').utterances[0].text, 'hello world')
})

test('mergeUtterances swallows the gap between two lines', () => {
  const result = mergeUtterances({ audioDurationMs: 2000, utterances: gapped() }, 'a')
  assert.equal(result.utterances[0].start, 0)
  assert.equal(result.utterances[0].end, 1500)
})

test('mergeUtterances is a no-op on the last line or an unknown id', () => {
  const source = fixture()
  assert.equal(mergeUtterances(source, 'c'), source)
  assert.equal(mergeUtterances(source, 'nope'), source)
})

test('insertUtteranceAfter fills the gap exactly', () => {
  const source: Transcript = { audioDurationMs: 2000, utterances: gapped() }
  const result = insertUtteranceAfter(source, 'a')
  assert.equal(result.utterances.length, 4)
  const inserted = result.utterances[1]
  assert.equal(inserted.start, 400)
  assert.equal(inserted.end, 1000)
  assert.equal(inserted.text, '')
  assert.notEqual(inserted.id, 'a')
  assert.equal(result.utterances[2].id, 'b')
})

test('insertUtteranceAfter is a no-op when the lines already touch', () => {
  const source = fixture()
  assert.equal(insertUtteranceAfter(source, 'a'), source)
  assert.equal(insertUtteranceAfter(source, 'c'), source)
  assert.equal(insertUtteranceAfter(source, 'nope'), source)
})

test('setUtteranceTime moves the edge it is given', () => {
  const result = setUtteranceTime(fixture(), 'b', 'start', 500)
  assert.equal(result.utterances[1].start, 500)
  assert.equal(result.utterances[1].end, 800)
})

test('setUtteranceTime clamps into the room the neighbours leave', () => {
  const source = fixture() // a 0-400, b 400-800, c 800-1000
  // Dragged before the previous line ends.
  assert.equal(setUtteranceTime(source, 'b', 'start', 100).utterances[1].start, 400)
  // Dragged past the next line's start.
  assert.equal(setUtteranceTime(source, 'b', 'end', 5000).utterances[1].end, 800)
  // The first line's start floors at zero, the last line's end is unbounded.
  assert.equal(setUtteranceTime(source, 'a', 'start', -9000).utterances[0].start, 0)
  assert.equal(setUtteranceTime(source, 'c', 'end', 99_000).utterances[2].end, 99_000)
})

test('setUtteranceTime never lets a line collapse', () => {
  const source = fixture()
  const result = setUtteranceTime(source, 'b', 'start', 800)
  assert.ok(result.utterances[1].start < result.utterances[1].end)
})

test('setUtteranceTime is a no-op for an unchanged value or an unknown id', () => {
  const source = fixture()
  assert.equal(setUtteranceTime(source, 'b', 'start', 400), source)
  assert.equal(setUtteranceTime(source, 'nope', 'start', 0), source)
})

function spoken(): Transcript {
  return {
    audioDurationMs: 1000,
    utterances: [
      { id: 'a', start: 0, end: 400, text: 'a', speakerId: '2', words: [] },
      { id: 'b', start: 400, end: 800, text: 'b', speakerId: '11', words: [] },
      { id: 'c', start: 800, end: 1000, text: 'c', speakerId: '2', words: [] }
    ]
  }
}

test('speakerIdsOf dedupes and sorts numerically, not as text', () => {
  // Sorted as text, "11" would land between "1" and "2".
  assert.deepEqual(speakerIdsOf(spoken()), ['2', '11'])
})

test('speakerIdsOf ignores lines with no speaker', () => {
  assert.deepEqual(speakerIdsOf(fixture()), [])
})

test('nextSpeakerId takes the lowest free number', () => {
  assert.equal(nextSpeakerId(spoken()), '1')
  assert.equal(nextSpeakerId(fixture()), '1')
  const dense: Transcript = {
    audioDurationMs: 1,
    utterances: [
      { id: 'a', start: 0, end: 1, text: '', speakerId: '1', words: [] },
      { id: 'b', start: 1, end: 2, text: '', speakerId: '2', words: [] }
    ]
  }
  assert.equal(nextSpeakerId(dense), '3')
})

test('setUtteranceSpeaker reassigns one line only', () => {
  const source = spoken()
  const result = setUtteranceSpeaker(source, 'a', '11')
  assert.equal(result.utterances[0].speakerId, '11')
  assert.equal(result.utterances[2].speakerId, '2')
  assert.equal(source.utterances[0].speakerId, '2')
})

test('setUtteranceSpeaker is a no-op for the same value or an unknown id', () => {
  const source = spoken()
  assert.equal(setUtteranceSpeaker(source, 'a', '2'), source)
  assert.equal(setUtteranceSpeaker(source, 'nope', '3'), source)
})

test('clampUtteranceTime agrees with what setUtteranceTime commits', () => {
  const source = fixture() // a 0-400, b 400-800, c 800-1000
  for (const timeMs of [-500, 0, 100, 400, 500, 790, 800, 5000]) {
    for (const edge of ['start', 'end'] as const) {
      const previewed = clampUtteranceTime(source.utterances, 'b', edge, timeMs)
      const committed = setUtteranceTime(source, 'b', edge, timeMs).utterances[1][edge]
      assert.equal(previewed, committed, `drifted at ${edge} ${timeMs}`)
    }
  }
})

test('removeUtterances drops the named lines and leaves the rest timed as they were', () => {
  const result = removeUtterances(fixture(), ['b'])
  assert.deepEqual(
    result.utterances.map((utterance) => [utterance.id, utterance.start, utterance.end]),
    [
      ['a', 0, 400],
      ['c', 800, 1000]
    ]
  )
})

test('removeUtterances returns the same transcript when nothing matched', () => {
  const source = fixture()
  assert.equal(removeUtterances(source, []), source)
  assert.equal(removeUtterances(source, ['nope']), source)
})

// A patch, not a replacement: the panel sends the one field that changed.
test('setUtteranceStyle merges into what the line already overrides', () => {
  const bold = setUtteranceStyle(fixture(), 'b', { bold: true })
  const coloured = setUtteranceStyle(bold, 'b', { color: '#ff0000' })
  assert.deepEqual(coloured.utterances[1].style, { bold: true, color: '#ff0000' })
})

test('setUtteranceStyle returns the same transcript when nothing differs', () => {
  const styled = setUtteranceStyle(fixture(), 'b', { bold: true })
  assert.equal(setUtteranceStyle(styled, 'b', { bold: true }), styled)
  assert.equal(setUtteranceStyle(styled, 'missing', { bold: true }), styled)
})

test('setUtteranceStyle leaves every other line alone', () => {
  const before = fixture()
  const after = setUtteranceStyle(before, 'b', { bold: true })
  assert.deepEqual(after.utterances[0], before.utterances[0])
  assert.equal(after.utterances[0].style, undefined)
  assert.equal(after.utterances[2].style, undefined)
})
