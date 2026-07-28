import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_STYLES,
  normalizeCaptionStyles,
  resolveCaptionStyle
} from './caption-style.ts'

test('a line with no speaker and no override gets the base', () => {
  const styles = { base: { fontFamily: 'Inter' }, bySpeaker: {} }
  assert.deepEqual(resolveCaptionStyle(styles, { speakerId: undefined }), { fontFamily: 'Inter' })
  assert.deepEqual(resolveCaptionStyle(styles), { fontFamily: 'Inter' })
})

test('a speaker override wins over the base', () => {
  const styles = { base: { fontFamily: 'Inter' }, bySpeaker: { '2': { fontFamily: 'Georgia' } } }
  assert.equal(resolveCaptionStyle(styles, { speakerId: '2' }).fontFamily, 'Georgia')
  assert.equal(resolveCaptionStyle(styles, { speakerId: '1' }).fontFamily, 'Inter')
})

test("a line's own override wins over its speaker's", () => {
  const styles = { base: { fontFamily: 'Inter' }, bySpeaker: { '2': { fontFamily: 'Georgia' } } }
  const line = { speakerId: '2', style: { fontFamily: 'Courier' } }
  assert.equal(resolveCaptionStyle(styles, line).fontFamily, 'Courier')
})

// The point of storing overrides as partials: a scope that did not set a field
// keeps following the base when the base changes.
test('an override that sets nothing still follows the base', () => {
  const styles = { base: { fontFamily: 'Inter' }, bySpeaker: { '2': {} } }
  assert.equal(resolveCaptionStyle(styles, { speakerId: '2' }).fontFamily, 'Inter')
})

test('resolving never returns a field the caller has to check', () => {
  const resolved = resolveCaptionStyle({ base: {} as never, bySpeaker: {} })
  assert.deepEqual(resolved, DEFAULT_CAPTION_STYLE)
})

// Everything below is the on-disk case: a project written before a field
// existed still has to open.
test('normalizing fills in a missing or malformed base', () => {
  assert.deepEqual(normalizeCaptionStyles(undefined), DEFAULT_CAPTION_STYLES)
  assert.deepEqual(normalizeCaptionStyles(null), DEFAULT_CAPTION_STYLES)
  assert.deepEqual(normalizeCaptionStyles({}), DEFAULT_CAPTION_STYLES)
  assert.deepEqual(normalizeCaptionStyles({ base: 42 }), DEFAULT_CAPTION_STYLES)
})

test('normalizing drops wrong-typed fields rather than carrying them through', () => {
  const styles = normalizeCaptionStyles({
    base: { fontFamily: 7 },
    bySpeaker: { '1': { fontFamily: [] }, '2': { fontFamily: 'Georgia' } }
  })
  assert.equal(styles.base.fontFamily, DEFAULT_CAPTION_STYLE.fontFamily)
  assert.deepEqual(styles.bySpeaker['1'], {})
  assert.deepEqual(styles.bySpeaker['2'], { fontFamily: 'Georgia' })
})

test('normalizing keeps a valid stored value intact', () => {
  const stored = { base: { fontFamily: 'Inter' }, bySpeaker: { '2': { fontFamily: 'Georgia' } } }
  assert.deepEqual(normalizeCaptionStyles(stored), stored)
})
