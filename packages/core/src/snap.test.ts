import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snapToNearest, utteranceEdges } from './snap.ts'

test('a time within tolerance moves onto the candidate', () => {
  assert.equal(snapToNearest(1005, [1000], 20), 1000)
  assert.equal(snapToNearest(995, [1000], 20), 1000)
})

test('a time outside tolerance is left exactly where it was', () => {
  assert.equal(snapToNearest(1050, [1000], 20), 1050)
  assert.equal(snapToNearest(1050, [], 20), 1050)
})

test('the nearest candidate wins', () => {
  assert.equal(snapToNearest(1040, [1000, 1050, 2000], 100), 1050)
})

// The caller orders candidates by precedence — the playhead before line edges,
// so that "line this up with where I am" beats "line this up with a neighbour".
test('among equally near candidates the first given wins', () => {
  assert.equal(snapToNearest(1000, [900, 1100], 200), 900)
})

test('a tolerance of zero or less snaps to nothing', () => {
  assert.equal(snapToNearest(1000, [1000], 0), 1000)
  assert.equal(snapToNearest(1005, [1000], 0), 1005)
  assert.equal(snapToNearest(1005, [1000], -5), 1005)
})

test('edges are both ends of every line, without repeats', () => {
  const lines = [
    { id: 'a', start: 0, end: 500 },
    // Touches the one before it: the shared edge is offered once.
    { id: 'b', start: 500, end: 900 }
  ]
  assert.deepEqual(
    utteranceEdges(lines).sort((x, y) => x - y),
    [0, 500, 900]
  )
})

// Without this the dragged edge snaps to itself, and the line's other end pulls
// it to zero length.
test('the lines being dragged offer no edges', () => {
  const lines = [
    { id: 'a', start: 0, end: 500 },
    { id: 'b', start: 700, end: 900 }
  ]
  assert.deepEqual(
    utteranceEdges(lines, ['a']).sort((x, y) => x - y),
    [700, 900]
  )
  assert.deepEqual(utteranceEdges(lines, ['a', 'b']), [])
})
