import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSrtTimestamp, toSrt } from './srt.ts'
import type { Utterance } from './types.ts'

test('formatSrtTimestamp uses HH:MM:SS,mmm with zero padding', () => {
  assert.equal(formatSrtTimestamp(0), '00:00:00,000')
  assert.equal(formatSrtTimestamp(7_120), '00:00:07,120')
  assert.equal(formatSrtTimestamp(3_661_005), '01:01:01,005')
})

test('toSrt serializes numbered CRLF blocks separated by blank lines', () => {
  const utterances: Utterance[] = [
    { id: 'a', start: 330, end: 1500, text: 'Hello there.', words: [] },
    { id: 'b', start: 1600, end: 3000, text: '第二句。', words: [] }
  ]
  const expected =
    '1\r\n00:00:00,330 --> 00:00:01,500\r\nHello there.\r\n' +
    '\r\n' +
    '2\r\n00:00:01,600 --> 00:00:03,000\r\n第二句。\r\n' +
    '\r\n'
  assert.equal(toSrt(utterances), expected)
})
