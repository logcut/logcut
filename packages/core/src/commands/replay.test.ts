import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommands, replayCommands } from './index.ts'
import type { EditCommand, EditDocument } from './index.ts'
import type { Transcript } from '../types.ts'

function transcript(): Transcript {
  return {
    audioDurationMs: 2000,
    utterances: [
      {
        id: 'a',
        start: 0,
        end: 400,
        text: '这个柑橘色我看起来有点偏绿',
        speakerId: '1',
        words: []
      },
      // A gap, so insertAfter has somewhere to put a line.
      { id: 'b', start: 600, end: 1200, text: '不是我最爱的颜色', speakerId: '1', words: [] },
      { id: 'c', start: 1200, end: 2000, text: '反正可以自己换', speakerId: '2', words: [] }
    ]
  }
}

function base(): EditDocument {
  return { transcripts: { asset1: transcript() } }
}

/** An edit session that exercises every command which creates or destroys a
 *  line, **and then edits what those lines created** — the part a replay only
 *  survives if identity is carried rather than invented. */
const SESSION: EditCommand[][] = [
  [{ kind: 'subtitle.split', assetId: 'asset1', id: 'b', timeMs: 900, newIds: ['b1', 'b2'] }],
  [{ kind: 'subtitle.setText', assetId: 'asset1', id: 'b2', text: '不是我最爱的' }],
  [{ kind: 'subtitle.insertAfter', assetId: 'asset1', afterId: 'a', newId: 'gap' }],
  [{ kind: 'subtitle.setText', assetId: 'asset1', id: 'gap', text: '插进来的一句' }],
  [{ kind: 'subtitle.setSpeaker', assetId: 'asset1', id: 'gap', speakerId: '2' }],
  [{ kind: 'subtitle.merge', assetId: 'asset1', firstId: 'b1' }],
  [{ kind: 'subtitle.setStyle', assetId: 'asset1', id: 'c', style: { bold: true } }],
  [{ kind: 'subtitle.setTime', assetId: 'asset1', id: 'c', edge: 'start', timeMs: 1300 }],
  [{ kind: 'subtitle.remove', assetId: 'asset1', ids: ['a'] }],
  [{ kind: 'subtitle.replaceAll', assetId: 'asset1', find: '的', replace: '之' }]
]

/** What the editor would have saved after that session. */
function live(): EditDocument {
  return SESSION.reduce((doc, batch) => applyCommands(doc, batch).doc, base())
}

test('replaying a session lands on the very same document', () => {
  assert.deepEqual(replayCommands(base(), SESSION), live())
})

test('replaying twice from the same base gives the same document twice', () => {
  // The one that catches a command inventing an id: two replays of an id-minting
  // command differ, and nothing else in this file would notice.
  assert.deepEqual(replayCommands(base(), SESSION), replayCommands(base(), SESSION))
})

test('a replay reaches lines that a command in the log created', () => {
  const replayed = replayCommands(base(), SESSION).transcripts['asset1']
  const inserted = replayed.utterances.find((utterance) => utterance.id === 'gap')
  // Created by insertAfter, then retitled and reassigned by two later commands —
  // all three would fail to line up if the id had been minted during the replay.
  assert.equal(inserted?.text, '插进来之一句')
  assert.equal(inserted?.speakerId, '2')
})

test('a batch that changes nothing is still replayed as a step', () => {
  const log: EditCommand[][] = [
    [{ kind: 'subtitle.setText', assetId: 'asset1', id: 'nobody', text: 'x' }],
    [{ kind: 'subtitle.setText', assetId: 'asset1', id: 'a', text: '改到了' }]
  ]
  assert.equal(replayCommands(base(), log).transcripts['asset1'].utterances[0].text, '改到了')
})

test('an empty log replays to the base itself', () => {
  const from = base()
  assert.equal(replayCommands(from, []), from)
})
