import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTimecode, formatTimecodeFull, parseTimecode } from './timecode.ts'

test('formatTimecode drops the hour below one', () => {
  assert.equal(formatTimecode(0), '00:00')
  assert.equal(formatTimecode(65_000), '01:05')
  assert.equal(formatTimecode(3_725_000), '1:02:05')
  assert.equal(formatTimecode(-5), '00:00')
})

test('formatTimecodeFull pads every field and never drops one', () => {
  assert.equal(formatTimecodeFull(505_400), '00:08:25.40')
  assert.equal(formatTimecodeFull(0), '00:00:00.00')
  assert.equal(formatTimecodeFull(3_725_070), '01:02:05.07')
  // Width is constant, which is what lets a column of them be read down.
  assert.equal(
    new Set([0, 1, 505_400, 3_725_070].map((ms) => formatTimecodeFull(ms).length)).size,
    1
  )
})

test('formatTimecodeFull truncates to hundredths rather than rounding up', () => {
  // Rounding up could push a line past its neighbour; truncating never can.
  assert.equal(formatTimecodeFull(1_009), '00:00:01.00')
  assert.equal(formatTimecodeFull(1_999), '00:00:01.99')
})

test('parseTimecode reads every accepted shape', () => {
  assert.equal(parseTimecode('30'), 30_000)
  assert.equal(parseTimecode('01:05'), 65_000)
  assert.equal(parseTimecode('1:02:05'), 3_725_000)
  assert.equal(parseTimecode('  08:25.400  '), 505_400)
})

test('parseTimecode pads a short fraction on the right', () => {
  // .4 is four hundred milliseconds, the way a decimal reads everywhere else.
  assert.equal(parseTimecode('00:01.4'), 1_400)
  assert.equal(parseTimecode('00:01.04'), 1_040)
  assert.equal(parseTimecode('00:01.004'), 1_004)
})

test('parseTimecode round-trips formatTimecodeFull down to its 10ms grid', () => {
  for (const ms of [0, 1, 999, 1_000, 505_400, 3_725_070, 86_399_999]) {
    const expected = Math.floor(ms / 10) * 10
    assert.equal(parseTimecode(formatTimecodeFull(ms)), expected, `round-trip failed for ${ms}`)
  }
})

test('parseTimecode rejects anything that is not a timecode', () => {
  for (const text of ['', 'abc', '1:2:3:4', '00:61', '1:75:00', '00:01.4567', '-5', '1,5']) {
    assert.equal(parseTimecode(text), null, `should have rejected ${JSON.stringify(text)}`)
  }
})
