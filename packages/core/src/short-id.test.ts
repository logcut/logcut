import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveShortId, shortIdMap, SHORT_ID_FLOOR } from './short-id.ts'

test('a prefix is never shorter than the floor', () => {
  const map = shortIdMap(['abcdefghijkl', 'zyxwvutsrqpo'])
  assert.equal(map.get('abcdefghijkl')?.length, SHORT_ID_FLOOR)
  assert.equal(map.get('zyxwvutsrqpo'), 'zyxwvuts')
})

test('a prefix grows past the floor only as far as it must', () => {
  // The two share nine characters, so nine is ambiguous and ten is not.
  const map = shortIdMap(['aaaaaaaaabbbb', 'aaaaaaaaacccc'])
  assert.equal(map.get('aaaaaaaaabbbb'), 'aaaaaaaaab')
  assert.equal(map.get('aaaaaaaaacccc'), 'aaaaaaaaac')
})

test('an id shorter than the floor is returned whole', () => {
  const map = shortIdMap(['ab', 'cd'])
  assert.equal(map.get('ab'), 'ab')
})

test('shortening is decided against the whole set, not one entry', () => {
  const alone = shortIdMap(['aaaaaaaaabbbb'])
  const together = shortIdMap(['aaaaaaaaabbbb', 'aaaaaaaaacccc'])
  // Same id, two answers — which is exactly why the map has to be built from
  // everything a reader may see rather than from one page of results.
  assert.equal(alone.get('aaaaaaaaabbbb')?.length, SHORT_ID_FLOOR)
  assert.equal(together.get('aaaaaaaaabbbb')?.length, SHORT_ID_FLOOR + 2)
})

test('resolve accepts a full id', () => {
  assert.equal(resolveShortId('abcdefghijkl', ['abcdefghijkl', 'zzz']), 'abcdefghijkl')
})

test('resolve accepts a unique prefix', () => {
  assert.equal(resolveShortId('abcd', ['abcdefghijkl', 'zzz']), 'abcdefghijkl')
})

test('an ambiguous prefix resolves to nothing, not to the first match', () => {
  assert.equal(resolveShortId('aaa', ['aaabbb', 'aaaccc']), null)
})

test('an exact match wins over being a prefix of something else', () => {
  // 'abc' is both an id and the start of another; the id itself must win.
  assert.equal(resolveShortId('abc', ['abcdef', 'abc']), 'abc')
})

test('an unknown prefix and an empty candidate both resolve to nothing', () => {
  assert.equal(resolveShortId('zzz', ['aaabbb']), null)
  assert.equal(resolveShortId('', ['aaabbb']), null)
})
