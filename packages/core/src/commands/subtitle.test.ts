import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, applyCommands } from './index.ts'
import type { EditDocument } from './index.ts'
import type { Transcript } from '../types.ts'

function transcript(): Transcript {
  return {
    audioDurationMs: 1000,
    utterances: [
      { id: 'a', start: 0, end: 400, text: 'AI 卷子来了', speakerId: '1', words: [] },
      // A gap follows, so insertAfter has somewhere to put a line.
      { id: 'b', start: 500, end: 800, text: '卷子卷子不是 Agent', speakerId: '1', words: [] },
      { id: 'c', start: 800, end: 1000, text: '没有匹配', speakerId: '2', words: [] }
    ]
  }
}

function doc(): EditDocument {
  return { transcripts: { asset1: transcript() } }
}

test('a command that changes nothing returns the same document', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.setText',
    assetId: 'asset1',
    id: 'a',
    text: 'AI 卷子来了'
  })

  assert.equal(result.doc, before)
  assert.deepEqual(result.changed, [])
  assert.equal(result.outcomes[0]?.changed, false)
  assert.equal(result.outcomes[0]?.focus, null)
})

test('setText reports the line it landed on', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.setText',
    assetId: 'asset1',
    id: 'b',
    text: '改好了'
  })

  assert.deepEqual(result.changed, ['asset1'])
  assert.deepEqual(result.outcomes[0]?.focus, {
    assetId: 'asset1',
    utteranceId: 'b',
    timeMs: 500
  })
  assert.equal(result.doc.transcripts.asset1?.utterances[1]?.text, '改好了')
})

test('naming an asset with no transcript is a no-op, not a throw', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.setText',
    assetId: 'missing',
    id: 'a',
    text: 'anything'
  })

  assert.equal(result.doc, before)
  assert.equal(result.outcomes[0]?.changed, false)
})

test('insertAfter focuses the line it created, not the one named', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.insertAfter',
    newId: 'inserted',
    assetId: 'asset1',
    afterId: 'a'
  })

  const focus = result.outcomes[0]?.focus
  assert.notEqual(focus, null)
  assert.notEqual(focus?.utteranceId, 'a')
  // It fills the gap exactly, so it starts where the named line ended.
  assert.equal(focus?.timeMs, 400)
  assert.equal(result.doc.transcripts.asset1?.utterances[1]?.id, focus?.utteranceId)
})

test('insertAfter where two lines already touch changes nothing', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.insertAfter',
    newId: 'inserted',
    assetId: 'asset1',
    afterId: 'b'
  })

  assert.equal(result.doc, before)
  assert.equal(result.outcomes[0]?.changed, false)
})

test('merge keeps the first line and focuses it', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.merge',
    assetId: 'asset1',
    firstId: 'a'
  })

  const merged = result.doc.transcripts.asset1?.utterances[0]
  assert.equal(merged?.id, 'a')
  assert.equal(merged?.end, 800)
  assert.equal(result.outcomes[0]?.focus?.utteranceId, 'a')
})

test('remove reports the change but no focus', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.remove',
    assetId: 'asset1',
    ids: ['a', 'c']
  })

  assert.equal(result.outcomes[0]?.changed, true)
  assert.equal(result.outcomes[0]?.focus, null)
  assert.deepEqual(
    result.doc.transcripts.asset1?.utterances.map((utterance) => utterance.id),
    ['b']
  )
})

test('replaceAll carries the count and stays unfocused', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.replaceAll',
    assetId: 'asset1',
    find: '卷子',
    replace: 'Agent'
  })

  const outcome = result.outcomes[0]
  assert.equal(outcome?.kind, 'subtitle.replaceAll')
  assert.equal(outcome.kind === 'subtitle.replaceAll' ? outcome.count : -1, 3)
  assert.equal(outcome?.focus, null)
})

test('replaceAll that matches nothing reports a count of zero', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.replaceAll',
    assetId: 'asset1',
    find: 'nowhere',
    replace: 'x'
  })

  const outcome = result.outcomes[0]
  assert.equal(result.doc, before)
  assert.equal(outcome.kind === 'subtitle.replaceAll' ? outcome.count : -1, 0)
})

test('clearStyle counts the lines that had styling of their own', () => {
  const styled = applyCommands(doc(), [
    { kind: 'subtitle.setStyle', assetId: 'asset1', id: 'a', style: { bold: true } },
    { kind: 'subtitle.setStyle', assetId: 'asset1', id: 'b', style: { italic: true } }
  ])

  const result = applyCommand(styled.doc, {
    kind: 'subtitle.clearStyle',
    assetId: 'asset1',
    // 'c' was never styled, so it is not part of the count.
    ids: ['a', 'b', 'c']
  })

  const outcome = result.outcomes[0]
  assert.equal(outcome?.kind, 'subtitle.clearStyle')
  assert.equal(outcome.kind === 'subtitle.clearStyle' ? outcome.count : -1, 2)
  assert.equal(outcome?.focus, null)
  assert.deepEqual(outcome?.lines, [])
  assert.equal(
    result.doc.transcripts.asset1?.utterances.every((utterance) => utterance.style === undefined),
    true
  )
})

test('clearStyle over lines that own nothing changes nothing', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.clearStyle',
    assetId: 'asset1',
    ids: ['a', 'b', 'c']
  })

  const outcome = result.outcomes[0]
  assert.equal(result.doc, before)
  assert.equal(outcome?.changed, false)
  assert.equal(outcome.kind === 'subtitle.clearStyle' ? outcome.count : -1, 0)
})

test('a batch chains: the second command sees the first one applied', () => {
  const result = applyCommands(doc(), [
    { kind: 'subtitle.merge', assetId: 'asset1', firstId: 'a' },
    { kind: 'subtitle.setText', assetId: 'asset1', id: 'a', text: '合并后再改' }
  ])

  assert.equal(result.doc.transcripts.asset1?.utterances[0]?.text, '合并后再改')
  assert.equal(result.doc.transcripts.asset1?.utterances[0]?.end, 800)
  assert.equal(result.outcomes.length, 2)
})

test('a batch lists each changed asset once', () => {
  const before: EditDocument = { transcripts: { asset1: transcript(), asset2: transcript() } }
  const result = applyCommands(before, [
    { kind: 'subtitle.setText', assetId: 'asset1', id: 'a', text: 'one' },
    { kind: 'subtitle.setText', assetId: 'asset1', id: 'b', text: 'two' },
    { kind: 'subtitle.setText', assetId: 'asset2', id: 'a', text: 'three' }
  ])

  assert.deepEqual(result.changed.sort(), ['asset1', 'asset2'])
  // Untouched transcripts keep their reference, which is what stops an undo
  // from rewriting every file on disk.
  assert.equal(
    result.doc.transcripts.asset2?.utterances[1],
    before.transcripts.asset2?.utterances[1]
  )
})

test('a batch where nothing changes returns the same document', () => {
  const before = doc()
  const result = applyCommands(before, [
    { kind: 'subtitle.merge', assetId: 'asset1', firstId: 'c' },
    { kind: 'subtitle.setSpeaker', assetId: 'asset1', id: 'a', speakerId: '1' }
  ])

  assert.equal(result.doc, before)
  assert.deepEqual(result.changed, [])
})

test('an outcome carries the line as it now stands', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.setText',
    assetId: 'asset1',
    id: 'b',
    text: '改好了'
  })

  // The point of this field: a reader with no copy of the document knows what
  // the line says now without fetching the transcript again.
  assert.deepEqual(result.outcomes[0]?.lines, [
    { assetId: 'asset1', id: 'b', startMs: 500, endMs: 800, text: '改好了', speakerId: '1' }
  ])
})

test('a merged line is reported with its new end', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.merge',
    assetId: 'asset1',
    firstId: 'a'
  })

  assert.equal(result.outcomes[0]?.lines[0]?.endMs, 800)
  assert.equal(result.outcomes[0]?.lines[0]?.id, 'a')
})

test('remove names what it dropped and reports no lines', () => {
  const outcome = applyCommand(doc(), {
    kind: 'subtitle.remove',
    assetId: 'asset1',
    ids: ['a', 'c']
  }).outcomes[0]

  assert.deepEqual(outcome?.lines, [])
  assert.deepEqual(outcome.kind === 'subtitle.remove' ? outcome.removedIds : [], ['a', 'c'])
})

test('remove reports only the ids that existed', () => {
  const outcome = applyCommand(doc(), {
    kind: 'subtitle.remove',
    assetId: 'asset1',
    ids: ['a', 'gone']
  }).outcomes[0]

  assert.deepEqual(outcome.kind === 'subtitle.remove' ? outcome.removedIds : [], ['a'])
})

test('replaceAll reports a count and leaves the new text to a query', () => {
  const outcome = applyCommand(doc(), {
    kind: 'subtitle.replaceAll',
    assetId: 'asset1',
    find: '卷子',
    replace: 'Agent'
  }).outcomes[0]

  assert.deepEqual(outcome?.lines, [])
  assert.equal(outcome.kind === 'subtitle.replaceAll' ? outcome.count : -1, 3)
})

test('a command may name a line by a unique prefix', () => {
  const long: EditDocument = {
    transcripts: {
      asset1: {
        audioDurationMs: 10,
        utterances: [
          { id: '3f2a91c0-aaaa', start: 0, end: 5, text: 'one', words: [] },
          { id: '7b4e05d9-bbbb', start: 5, end: 10, text: 'two', words: [] }
        ]
      }
    }
  }
  const result = applyCommand(long, {
    kind: 'subtitle.setText',
    assetId: 'asset1',
    id: '3f2a91c0',
    text: 'edited'
  })

  assert.equal(result.doc.transcripts.asset1?.utterances[0]?.text, 'edited')
  // The outcome answers in full ids; shortening is the output side's business.
  assert.equal(result.outcomes[0]?.lines[0]?.id, '3f2a91c0-aaaa')
})

test('an ambiguous prefix edits nothing', () => {
  const long: EditDocument = {
    transcripts: {
      asset1: {
        audioDurationMs: 10,
        utterances: [
          { id: 'aaa-1', start: 0, end: 5, text: 'one', words: [] },
          { id: 'aaa-2', start: 5, end: 10, text: 'two', words: [] }
        ]
      }
    }
  }
  const result = applyCommand(long, {
    kind: 'subtitle.setText',
    assetId: 'asset1',
    id: 'aaa',
    text: 'edited'
  })

  assert.equal(result.doc, long)
  assert.equal(result.outcomes[0]?.changed, false)
})

test('setTime clamps into the room the neighbours leave', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.setTime',
    assetId: 'asset1',
    id: 'b',
    edge: 'start',
    // Well before the previous line ends; it lands on that end instead.
    timeMs: 100
  })

  assert.equal(result.doc.transcripts.asset1?.utterances[1]?.start, 400)
  assert.equal(result.outcomes[0]?.focus?.timeMs, 400)
})

test('split focuses the second half, not the first line of the transcript', () => {
  const result = applyCommand(doc(), {
    kind: 'subtitle.split',
    newIds: ['half1', 'half2'],
    assetId: 'asset1',
    id: 'b',
    timeMs: 600
  })

  const lines = result.doc.transcripts.asset1?.utterances ?? []
  assert.equal(lines.length, 4)
  // Neither half keeps the id that was cut, so looking the index up after the
  // cut found nothing and landed on utterances[0] — the wrong line entirely.
  assert.equal(result.outcomes[0]?.focus?.utteranceId, lines[2]?.id)
  assert.equal(result.outcomes[0]?.focus?.timeMs, 600)
})

test('split on a line bound changes nothing', () => {
  const before = doc()
  const result = applyCommand(before, {
    kind: 'subtitle.split',
    newIds: ['half1', 'half2'],
    assetId: 'asset1',
    id: 'b',
    timeMs: 500
  })

  assert.equal(result.doc, before)
  assert.equal(result.outcomes[0]?.changed, false)
})
