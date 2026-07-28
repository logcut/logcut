import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EditDocument } from './commands/index.ts'
import { queryUtterances } from './query.ts'
import type { Transcript } from './types.ts'

function transcript(): Transcript {
  return {
    audioDurationMs: 1000,
    utterances: [
      { id: 'a', start: 0, end: 400, text: '今天 KK 要改造我', speakerId: '1', words: [] },
      { id: 'b', start: 400, end: 800, text: '预算大概是多少', words: [] },
      { id: 'c', start: 800, end: 1000, text: '预算还没定', speakerId: '2', words: [] }
    ]
  }
}

function doc(): EditDocument {
  return { transcripts: { asset1: transcript() } }
}

test('an empty query returns every line with its asset', () => {
  const result = queryUtterances(doc())
  assert.equal(result.total, 3)
  assert.equal(result.lines.length, 3)
  assert.deepEqual(result.lines[0], {
    assetId: 'asset1',
    id: 'a',
    startMs: 0,
    endMs: 400,
    text: '今天 KK 要改造我',
    speakerId: '1'
  })
})

test('a line with no speaker omits the key rather than carrying undefined', () => {
  const line = queryUtterances(doc(), { search: '预算大概' }).lines[0]
  assert.equal(line !== undefined && 'speakerId' in line, false)
})

test('search is case-insensitive and literal', () => {
  const doc: EditDocument = {
    transcripts: {
      asset1: {
        audioDurationMs: 10,
        utterances: [
          { id: 'a', start: 0, end: 5, text: 'Budget and Scope', words: [] },
          { id: 'b', start: 5, end: 10, text: 'b.dget', words: [] }
        ]
      }
    }
  }
  assert.equal(queryUtterances(doc, { search: 'budget' }).total, 1)
  // A dot is a dot, not "any character".
  assert.equal(queryUtterances(doc, { search: 'b.dget' }).total, 1)
})

test('a window takes every line it touches, not only those wholly inside', () => {
  // 300–500 covers the end of the first line and the start of the second.
  const result = queryUtterances(doc(), { fromMs: 300, toMs: 500 })
  assert.deepEqual(
    result.lines.map((line) => line.id),
    ['a', 'b']
  )
})

test('a window boundary excludes a line that merely ends on it', () => {
  const result = queryUtterances(doc(), { fromMs: 400 })
  assert.deepEqual(
    result.lines.map((line) => line.id),
    ['b', 'c']
  )
})

test('total counts the matches, not the page', () => {
  const result = queryUtterances(doc(), { limit: 1 })
  assert.equal(result.lines.length, 1)
  // The point of the pair: a reader can tell a page from the whole answer.
  assert.equal(result.total, 3)
})

test('offset walks the pages', () => {
  const result = queryUtterances(doc(), { offset: 2, limit: 2 })
  assert.deepEqual(
    result.lines.map((line) => line.id),
    ['c']
  )
  assert.equal(result.total, 3)
})

test('an assetId narrows to that asset, and an unknown one answers nothing', () => {
  const both: EditDocument = { transcripts: { asset1: transcript(), asset2: transcript() } }
  assert.equal(queryUtterances(both).total, 6)
  assert.equal(queryUtterances(both, { assetId: 'asset2' }).total, 3)
  assert.equal(queryUtterances(both, { assetId: 'nope' }).total, 0)
})

test('filters combine', () => {
  const result = queryUtterances(doc(), { search: '预算', fromMs: 800 })
  assert.deepEqual(
    result.lines.map((line) => line.id),
    ['c']
  )
})
