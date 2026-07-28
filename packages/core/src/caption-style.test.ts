import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CAPTION_REFERENCE_HEIGHT,
  CAPTION_STYLE_LIMITS,
  captionLengthFor,
  captionSizePct,
  captionSizePx,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_STYLES,
  normalizeCaptionStyles,
  resolveCaptionStyle
} from './caption-style.ts'

test('a line with no speaker and no override gets the base', () => {
  const styles = { base: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' }, bySpeaker: {} }
  const expected = { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' }
  assert.deepEqual(resolveCaptionStyle(styles, { speakerId: undefined }), expected)
  assert.deepEqual(resolveCaptionStyle(styles), expected)
})

test('a speaker override wins over the base', () => {
  const styles = {
    base: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' },
    bySpeaker: { '2': { fontFamily: 'Georgia' } }
  }
  assert.equal(resolveCaptionStyle(styles, { speakerId: '2' }).fontFamily, 'Georgia')
  assert.equal(resolveCaptionStyle(styles, { speakerId: '1' }).fontFamily, 'Inter')
})

test("a line's own override wins over its speaker's", () => {
  const styles = {
    base: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' },
    bySpeaker: { '2': { fontFamily: 'Georgia' } }
  }
  const line = { speakerId: '2', style: { fontFamily: 'Courier' } }
  assert.equal(resolveCaptionStyle(styles, line).fontFamily, 'Courier')
})

// The point of storing overrides as partials: a scope that did not set a field
// keeps following the base when the base changes.
test('an override that sets nothing still follows the base', () => {
  const styles = { base: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' }, bySpeaker: { '2': {} } }
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

// A base is completed, an override is not — the two halves of the same read.
test('normalizing completes the base and leaves an override as it found it', () => {
  const stored = { base: { fontFamily: 'Inter' }, bySpeaker: { '2': { fontFamily: 'Georgia' } } }
  assert.deepEqual(normalizeCaptionStyles(stored), {
    base: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter' },
    bySpeaker: { '2': { fontFamily: 'Georgia' } }
  })
})

test('every field survives a round trip through normalizing', () => {
  const styles: unknown = {
    base: {
      fontFamily: 'Inter',
      fontSizePct: 7.5,
      bold: true,
      italic: true,
      underline: true,
      color: '#ff8800',
      letterSpacing: 12,
      lineSpacing: 30,
      align: 'left',
      x: 0.25,
      y: 0.5,
      rotation: -15
    },
    bySpeaker: {}
  }
  assert.deepEqual(normalizeCaptionStyles(styles), styles)
})

test('numbers out of range are clamped, not dropped', () => {
  const styles = normalizeCaptionStyles({
    base: { fontSizePct: 999, letterSpacing: -5000, lineSpacing: 5000 }
  })
  assert.equal(styles.base.fontSizePct, CAPTION_STYLE_LIMITS.fontSizePct.max)
  assert.equal(styles.base.letterSpacing, CAPTION_STYLE_LIMITS.letterSpacing.min)
  assert.equal(styles.base.lineSpacing, CAPTION_STYLE_LIMITS.lineSpacing.max)
})

test('a malformed colour or alignment falls back rather than reaching CSS', () => {
  const styles = normalizeCaptionStyles({
    base: { color: 'red; background: url(x)', align: 'justify' }
  })
  assert.equal(styles.base.color, DEFAULT_CAPTION_STYLE.color)
  assert.equal(styles.base.align, DEFAULT_CAPTION_STYLE.align)
})

test('NaN is not a number here', () => {
  const styles = normalizeCaptionStyles({ base: { fontSizePct: NaN, lineSpacing: Infinity } })
  assert.equal(styles.base.fontSizePct, DEFAULT_CAPTION_STYLE.fontSizePct)
  assert.equal(styles.base.lineSpacing, DEFAULT_CAPTION_STYLE.lineSpacing)
})

// The distinction the two readers exist for: a base must come out complete, an
// override must not gain fields its author never set.
test('an override keeps only the fields it actually carries', () => {
  const styles = normalizeCaptionStyles({
    base: {},
    bySpeaker: { '2': { bold: true }, '3': { bold: 'yes' } }
  })
  assert.deepEqual(styles.bySpeaker['2'], { bold: true })
  assert.deepEqual(styles.bySpeaker['3'], {})
  assert.deepEqual(styles.base, DEFAULT_CAPTION_STYLE)
})

test('a speaker override of one field leaves the rest following the base', () => {
  const styles = normalizeCaptionStyles({
    base: { color: '#00ff00', bold: true },
    bySpeaker: { '2': { color: '#ff0000' } }
  })
  const resolved = resolveCaptionStyle(styles, { speakerId: '2' })
  assert.equal(resolved.color, '#ff0000')
  assert.equal(resolved.bold, true)
})

test('a centre outside the picture is pulled back onto it', () => {
  const styles = normalizeCaptionStyles({ base: { x: 5, y: -3, rotation: 900 } })
  assert.equal(styles.base.x, CAPTION_STYLE_LIMITS.x.max)
  assert.equal(styles.base.y, CAPTION_STYLE_LIMITS.y.min)
  assert.equal(styles.base.rotation, CAPTION_STYLE_LIMITS.rotation.max)
})

test('a length scales with the picture it is drawn on', () => {
  // The same stored number is half the pixels on a half-height frame.
  assert.equal(captionLengthFor(20, CAPTION_REFERENCE_HEIGHT), 20)
  assert.equal(captionLengthFor(20, CAPTION_REFERENCE_HEIGHT / 2), 10)
  assert.equal(captionLengthFor(20, CAPTION_REFERENCE_HEIGHT * 2), 40)
  assert.equal(captionLengthFor(0, 720), 0)
})

test('size converts to pixels at the reference height and back', () => {
  assert.equal(captionSizePx(5), 54)
  assert.equal(captionSizePx(10), 108)
  assert.equal(captionSizePct(54), 5)
  assert.equal(captionSizePct(108), 10)
})

// The round trip a user performs by reading the box and typing it back.
test('a size typed back in is the size that was shown', () => {
  for (let pct = CAPTION_STYLE_LIMITS.fontSizePct.min; pct <= 20; pct += 0.5) {
    assert.equal(captionSizePct(captionSizePx(pct)), pct, `${pct}% did not survive`)
  }
})
