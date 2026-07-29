import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAssTimestamp, toAss } from './ass.ts'
import type { AssInput, AssLine } from './ass.ts'
import { DEFAULT_CAPTION_STYLES } from './caption-style.ts'

function input(lines: AssLine[], overrides: Partial<AssInput> = {}): AssInput {
  return {
    lines,
    styles: DEFAULT_CAPTION_STYLES,
    frame: { width: 1920, height: 1080 },
    systemFont: 'Helvetica',
    ...overrides
  }
}

function dialogues(ass: string): string[] {
  return ass.split('\n').filter((line) => line.startsWith('Dialogue:'))
}

/** Every pass one caption produced, bottom layer first. */
function eventsFor(ass: string, text: string): string[] {
  return dialogues(ass).filter((line) => line.endsWith(`}${text}`))
}

/** The pass that draws the letterforms — always a caption's last, whatever is
 *  under it. */
function textEvent(ass: string, text: string): string {
  const events = eventsFor(ass, text)
  return events[events.length - 1] ?? ''
}

test('formatAssTimestamp uses H:MM:SS.cc and truncates to centiseconds', () => {
  assert.equal(formatAssTimestamp(0), '0:00:00.00')
  assert.equal(formatAssTimestamp(7_129), '0:00:07.12')
  assert.equal(formatAssTimestamp(3_661_005), '1:01:01.00')
  // Ten hours still gets one digit; ASS does not pad the hour.
  assert.equal(formatAssTimestamp(36_000_000), '10:00:00.00')
})

test('toAss declares the picture as the play resolution', () => {
  const ass = toAss(input([], { frame: { width: 3840, height: 2160 } }))
  assert.match(ass, /^PlayResX: 3840$/m)
  assert.match(ass, /^PlayResY: 2160$/m)
})

test('toAss positions the block by its centre with \\an5', () => {
  const ass = toAss(input([{ start: 0, end: 1000, text: 'hi' }]))
  // Defaults are x 0.5, y 0.88 of a 1920x1080 frame.
  assert.match(dialogues(ass)[0], /\{\\an5\\pos\(960,950\.4\)/)
})

test('toAss wraps the overrides in braces, so they are markup and not the caption', () => {
  const line = dialogues(toAss(input([{ start: 0, end: 1, text: 'hi' }])))[0]
  assert.match(line, /,,\{\\an5.*\\frz0\}hi$/)
})

test('toAss scales the font size to the real picture, not the reference height', () => {
  const at1080 = toAss(input([{ start: 0, end: 1, text: 'hi' }]))
  const at2160 = toAss(
    input([{ start: 0, end: 1, text: 'hi' }], { frame: { width: 3840, height: 2160 } })
  )
  // 5% of the picture height, so it doubles when the picture does.
  assert.match(dialogues(at1080)[0], /\\fs54\b/)
  assert.match(dialogues(at2160)[0], /\\fs108\b/)
})

test('toAss reverses the colour channels', () => {
  const styles = {
    ...DEFAULT_CAPTION_STYLES,
    base: { ...DEFAULT_CAPTION_STYLES.base, color: '#112233' }
  }
  const ass = toAss(input([{ start: 0, end: 1, text: 'hi' }], { styles }))
  assert.match(dialogues(ass)[0], /\\c&H332211&/)
})

test('toAss negates the rotation, because ASS turns the other way', () => {
  const styles = {
    ...DEFAULT_CAPTION_STYLES,
    base: { ...DEFAULT_CAPTION_STYLES.base, rotation: 30 }
  }
  const ass = toAss(input([{ start: 0, end: 1, text: 'hi' }], { styles }))
  assert.match(dialogues(ass)[0], /\\frz-30/)
})

test('toAss resolves the system font sentinel to what the caller passes', () => {
  const ass = toAss(input([{ start: 0, end: 1, text: 'hi' }], { systemFont: 'PingFang SC' }))
  assert.match(dialogues(ass)[0], /\\fnPingFang SC/)

  const named = {
    ...DEFAULT_CAPTION_STYLES,
    base: { ...DEFAULT_CAPTION_STYLES.base, fontFamily: 'Georgia' }
  }
  assert.match(
    dialogues(toAss(input([{ start: 0, end: 1, text: 'hi' }], { styles: named })))[0],
    /\\fnGeorgia/
  )
})

test('toAss flattens the cascade per line', () => {
  const styles = {
    base: { ...DEFAULT_CAPTION_STYLES.base, color: '#ffffff' },
    bySpeaker: { s1: { color: '#ff0000' } }
  }
  const ass = toAss(
    input(
      [
        { start: 0, end: 1, text: 'base' },
        { start: 2, end: 3, text: 'speaker', speakerId: 's1' },
        { start: 4, end: 5, text: 'line', speakerId: 's1', style: { color: '#00ff00' } }
      ],
      { styles }
    )
  )
  assert.match(textEvent(ass, 'base'), /\\c&HFFFFFF&/)
  assert.match(textEvent(ass, 'speaker'), /\\c&H0000FF&/)
  assert.match(textEvent(ass, 'line'), /\\c&H00FF00&/)
})

test('toAss declares one style per border style, whatever the alignments are', () => {
  const styles = {
    base: { ...DEFAULT_CAPTION_STYLES.base, align: 'left' as const },
    bySpeaker: { s1: { align: 'right' as const } }
  }
  const ass = toAss(
    input(
      [
        { start: 0, end: 1, text: 'a' },
        { start: 2, end: 3, text: 'b', speakerId: 's1' }
      ],
      { styles }
    )
  )
  // Two, and never more: alignment is not expressed through the style table,
  // so the count is fixed by the two border styles a caption can need.
  assert.equal(ass.split('\n').filter((line) => line.startsWith('Style:')).length, 2)
  // The bundled libass ignores the `Justify` field, so nothing is written that
  // claims an alignment it cannot deliver — see ass.md.
  assert.doesNotMatch(ass, /Justify/)
  // Each caption is its plate and then its type; neither alignment nor the
  // speaker adds a style, because neither is expressed through the table.
  for (const text of ['a', 'b']) {
    const events = eventsFor(ass, text)
    assert.equal(events.length, 2)
    assert.match(events[0], /^Dialogue: 0,[^,]+,[^,]+,Plate,/)
    assert.match(events[1], /^Dialogue: 1,[^,]+,[^,]+,Stroke,/)
  }
})

test('toAss still declares its styles when there is nothing to burn', () => {
  assert.match(toAss(input([])), /^Style: Plate,/m)
  assert.match(toAss(input([])), /^Style: Stroke,/m)
})

test('toAss escapes braces and turns newlines into hard breaks', () => {
  const ass = toAss(input([{ start: 0, end: 1, text: 'a {b} c\nd' }]))
  assert.ok(dialogues(ass)[0].endsWith('a \\{b\\} c\\Nd'))
})

test('toAss paints the plate as an opaque box with unsquare padding', () => {
  const line = dialogues(toAss(input([{ start: 0, end: 1, text: 'hi' }])))[0]
  assert.match(line, /\\3c&H000000&/)
  assert.match(line, /\\3a&H66&/)
  assert.match(line, /\\xbord12\\ybord4/)
  assert.match(line, /\\shad0/)
  // BorderStyle 3 is the only thing that makes those borders a plate.
  assert.match(toAss(input([{ start: 0, end: 1, text: 'hi' }])), /^Style: Plate,.*,3,0,0,5,/m)
})

// The plate and the stroke cannot be one event: under BorderStyle 3 the outline
// colour is the plate's fill, so asking for a stroke only repaints the box.
test('an outlined caption burns as two events, the stroke over the plate', () => {
  const styles = {
    base: {
      ...DEFAULT_CAPTION_STYLES.base,
      outline: true,
      outlineColor: '#ff0000',
      outlineOpacityPct: 100,
      outlineWidth: 5
    },
    bySpeaker: {}
  }
  const events = dialogues(toAss(input([{ start: 0, end: 1, text: 'hi' }], { styles })))
  assert.equal(events.length, 2)

  const [plate, stroke] = events
  assert.ok(plate.startsWith('Dialogue: 0,'), 'the plate is the lower layer')
  assert.ok(stroke.startsWith('Dialogue: 1,'), 'the stroke is painted over it')
  assert.match(plate, /,Plate,/)
  assert.match(stroke, /,Stroke,/)
  // The plate keeps its own black box; the stroke states the caption's colour.
  assert.match(plate, /\\3c&H000000&/)
  assert.match(stroke, /\\3c&H0000FF&/)
  assert.match(stroke, /\\3a&H00&/)
  assert.match(stroke, /\\bord5/)
  // Same geometry on both, or the glyphs of one do not sit under the other's.
  for (const tag of [/\\pos\(([^)]+)\)/, /\\fs([\d.]+)/, /\\frz([-\d.]+)/]) {
    assert.equal(plate.match(tag)?.[1], stroke.match(tag)?.[1], `${tag} differs between layers`)
  }
})

test('a caption pays for the layers it switches on and no others', () => {
  const base = DEFAULT_CAPTION_STYLES.base
  const line: AssLine[] = [{ start: 0, end: 1, text: 'hi' }]
  const count = (overrides: Partial<typeof base>): number =>
    dialogues(toAss(input(line, { styles: { base: { ...base, ...overrides }, bySpeaker: {} } })))
      .length

  // Type on its own is one event; the plate, the shadow and nothing else add
  // one apiece. An outline rides on the pass that draws the type.
  assert.equal(count({ background: false }), 1)
  assert.equal(count({ background: false, outline: true }), 1)
  assert.equal(count({}), 2)
  assert.equal(count({ background: false, shadow: true }), 2)
  assert.equal(count({ shadow: true, outline: true }), 3)
})

test('the outline width scales with the picture, like every other length', () => {
  const styles = {
    base: { ...DEFAULT_CAPTION_STYLES.base, outline: true, outlineWidth: 5 },
    bySpeaker: {}
  }
  const events = dialogues(
    toAss(
      input([{ start: 0, end: 1, text: 'hi' }], { styles, frame: { width: 3840, height: 2160 } })
    )
  )
  assert.match(events[1], /\\bord10/)
})

test('toAss scales the plate padding with the picture', () => {
  const line = dialogues(
    toAss(input([{ start: 0, end: 1, text: 'hi' }], { frame: { width: 3840, height: 2160 } }))
  )[0]
  assert.match(line, /\\xbord24\\ybord8/)
})

/** One caption, one style override, all the events it produced. */
function burn(
  overrides: Partial<typeof DEFAULT_CAPTION_STYLES.base>,
  frameHeight = 1080
): string[] {
  return dialogues(
    toAss(
      input([{ start: 0, end: 1, text: 'hi' }], {
        styles: { base: { ...DEFAULT_CAPTION_STYLES.base, ...overrides }, bySpeaker: {} },
        frame: { width: (frameHeight * 16) / 9, height: frameHeight }
      })
    )
  )
}

test('the plate lays the text out but never paints it', () => {
  // Fully transparent primary: the box still has to measure the text to know
  // how big it is, and the pass above is what puts the letterforms on screen.
  assert.match(burn({})[0], /\\1a&HFF&/)
})

test('the plate takes its colour and opacity from the style', () => {
  const [plate] = burn({ backgroundColor: '#ff0000', backgroundOpacityPct: 50 })
  assert.match(plate, /\\3c&H0000FF&/)
  // 50% opaque is 128 transparent, and ASS states the transparent share.
  assert.match(plate, /\\3a&H80&/)
})

test('the default plate is the black at 60% every build has burned', () => {
  const [plate] = burn({})
  assert.match(plate, /\\3c&H000000&/)
  assert.match(plate, /\\3a&H66&/)
})

test('switching the background off leaves the type alone on the picture', () => {
  const events = burn({ background: false })
  assert.equal(events.length, 1)
  assert.match(events[0], /,Stroke,/)
  assert.doesNotMatch(events[0], /\\xbord/)
})

test('the fill opacity reaches the pass that draws the type', () => {
  assert.match(burn({ fillOpacityPct: 25 })[1], /\\1a&HBF&/)
})

test('the shadow is its own event, under the type and over the plate', () => {
  const [plate, shadow, text] = burn({ shadow: true, shadowColor: '#00ff00' })
  assert.match(plate, /^Dialogue: 0,[^,]+,[^,]+,Plate,/)
  assert.match(shadow, /^Dialogue: 1,[^,]+,[^,]+,Stroke,/)
  assert.match(text, /^Dialogue: 2,[^,]+,[^,]+,Stroke,/)
  // The shadow is a copy of the letterforms in its own colour, with no border
  // of its own to draw.
  assert.match(shadow, /\\c&H00FF00&/)
  assert.match(shadow, /\\bord0/)
})

test('the shadow of stroked type is stroked too, in the shadow colour', () => {
  const [, shadow] = burn({
    shadow: true,
    shadowColor: '#00ff00',
    outline: true,
    outlineColor: '#ff0000',
    outlineWidth: 5
  })
  // The silhouette that casts the shadow includes the stroke, so the shadow
  // carries the same width — but never the outline's colour.
  assert.match(shadow, /\\bord5/)
  assert.match(shadow, /\\3c&H00FF00&/)
  assert.doesNotMatch(shadow, /\\3c&H0000FF&/)
})

test('an unstroked shadow is a plain copy of the letterforms', () => {
  const [, shadow] = burn({ shadow: true, outline: false })
  assert.match(shadow, /\\bord0/)
})

test('only the shadow is blurred, because a blur takes the whole event', () => {
  const [plate, shadow, text] = burn({ shadow: true, shadowBlur: 5, outline: true })
  assert.match(shadow, /\\blur5/)
  assert.match(plate, /\\blur0/)
  assert.match(text, /\\blur0/)
})

test('the shadow falls at its angle, and its distance scales with the picture', () => {
  // 0 degrees is due right, so the whole distance lands on x and none on y.
  const [, right] = burn({ shadow: true, shadowDistance: 10, shadowAngle: 0 })
  assert.match(right, /\\pos\(970,950\.4\)/)
  // 90 is straight down, y growing downward as it does on screen.
  const [, down] = burn({ shadow: true, shadowDistance: 10, shadowAngle: 90 })
  assert.match(down, /\\pos\(960,960\.4\)/)
  // Twice the picture, twice the offset — a shadow measured at 1080 like every
  // other length here.
  const [, at2160] = burn({ shadow: true, shadowDistance: 10, shadowAngle: 0 }, 2160)
  assert.match(at2160, /\\pos\(1940,1900\.8\)/)
})

test('the shadow turns with the caption, because \\pos is in screen space', () => {
  // Offset due right of an upright caption, rotated 90 clockwise: the shadow
  // has to end up below it, not still to its right.
  const [, shadow] = burn({ shadow: true, shadowDistance: 10, shadowAngle: 0, rotation: 90 })
  assert.match(shadow, /\\pos\(960,960\.4\)/)
})

test('the plate radius is not written, having nothing in ASS to land on', () => {
  // An opaque box has square corners; a value that cannot be delivered is not
  // claimed in the document — see ass.md.
  const ass = toAss(
    input([{ start: 0, end: 1, text: 'hi' }], {
      styles: {
        base: { ...DEFAULT_CAPTION_STYLES.base, backgroundRadius: 40 },
        bySpeaker: {}
      }
    })
  )
  assert.doesNotMatch(ass, /40/)
})
