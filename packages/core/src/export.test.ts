import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captionLinesFor, planExport } from './export.ts'
import type { ExportClip, ExportInput } from './export.ts'
import type { Transcript } from './types.ts'

function clip(overrides: Partial<ExportClip> = {}): ExportClip {
  return {
    path: '/media/a.mp4',
    durationMs: 5000,
    hasAudio: true,
    width: 1920,
    height: 1080,
    ...overrides
  }
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    clips: [clip()],
    frame: { width: 1920, height: 1080 },
    captionTrackFile: null,
    videoArgs: ['-c:v', 'h264_videotoolbox', '-b:v', '8000k'],
    audioArgs: ['-c:a', 'aac', '-b:a', '192k'],
    fps: 0,
    audio: { channels: 2, sampleRate: 48_000 },
    videoOnly: false,
    outputPath: '/out/film.mp4',
    ...overrides
  }
}

/** The filtergraph, which is one argument however long it reads. */
function graph(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1]
}

test('captionLinesFor moves each utterance onto the timeline clock', () => {
  const transcripts: Record<string, Transcript> = {
    one: {
      audioDurationMs: 5000,
      utterances: [{ id: 'a', start: 100, end: 900, text: 'first', words: [] }]
    },
    two: {
      audioDurationMs: 5000,
      utterances: [{ id: 'b', start: 200, end: 800, text: 'second', words: [] }]
    }
  }
  const lines = captionLinesFor(
    [
      { assetId: 'one', startMs: 0 },
      { assetId: 'two', startMs: 5000 }
    ],
    transcripts
  )
  assert.deepEqual(
    lines.map((line) => [line.text, line.start, line.end]),
    [
      ['first', 100, 900],
      ['second', 5200, 5800]
    ]
  )
})

test('captionLinesFor carries the speaker and per-line style the cascade needs', () => {
  const transcripts: Record<string, Transcript> = {
    one: {
      audioDurationMs: 1000,
      utterances: [
        {
          id: 'a',
          start: 0,
          end: 500,
          text: 'x',
          speakerId: 's1',
          style: { bold: true },
          words: []
        }
      ]
    }
  }
  const [line] = captionLinesFor([{ assetId: 'one', startMs: 0 }], transcripts)
  assert.equal(line.speakerId, 's1')
  assert.deepEqual(line.style, { bold: true })
})

test('captionLinesFor treats an asset with no transcript as nothing to burn', () => {
  assert.deepEqual(captionLinesFor([{ assetId: 'missing', startMs: 0 }], {}), [])
})

test('captionLinesFor lays the same asset down twice at both its positions', () => {
  const transcripts: Record<string, Transcript> = {
    one: {
      audioDurationMs: 1000,
      utterances: [{ id: 'a', start: 100, end: 200, text: 'x', words: [] }]
    }
  }
  const lines = captionLinesFor(
    [
      { assetId: 'one', startMs: 0 },
      { assetId: 'one', startMs: 1000 }
    ],
    transcripts
  )
  assert.deepEqual(
    lines.map((line) => line.start),
    [100, 1100]
  )
})

test('planExport remuxes a lone clip that has nothing burned into it', () => {
  const plan = planExport(input())
  assert.equal(plan.reencodes, false)
  assert.deepEqual(plan.args, [
    '-y',
    '-hide_banner',
    '-nostats',
    '-progress',
    'pipe:1',
    '-i',
    '/media/a.mp4',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '/out/film.mp4'
  ])
})

test('planExport re-encodes as soon as the export asks for anything', () => {
  // Each of these alone is a reason the source is no longer the export: copying
  // it through would hand back a file that disagrees with what was asked for.
  const reasons: Partial<ExportInput>[] = [
    { frame: { width: 1280, height: 720 } },
    { fps: 30 },
    { captionTrackFile: 'captions.txt' }
  ]
  for (const reason of reasons) {
    assert.equal(planExport(input(reason)).reencodes, true, JSON.stringify(reason))
  }
  // Nothing asked for, so nothing is re-encoded.
  assert.equal(planExport(input()).reencodes, false)
})

test('planExport drops the audio without decoding it when only the video is wanted', () => {
  const remux = planExport(input({ videoOnly: true }))
  assert.equal(remux.reencodes, false)
  assert.ok(remux.args.includes('-an'))

  const render = planExport(input({ videoOnly: true, captionTrackFile: 'captions.txt' }))
  assert.doesNotMatch(graph(render.args), /aformat|anullsrc/)
  assert.ok(!render.args.includes('-c:a'), 'no audio codec when there is no audio')
  assert.equal(render.args.filter((arg) => arg === '-map').length, 1)
})

test('planExport concatenates video alone when the audio is not wanted', () => {
  const plan = planExport(
    input({ clips: [clip(), clip({ path: '/media/b.mp4' })], videoOnly: true })
  )
  assert.match(graph(plan.args), /\[v0\]\[v1\]concat=n=2:v=1:a=0\[vcat\]/)
})

test('planExport normalizes the frame rate only when one was asked for', () => {
  assert.doesNotMatch(graph(planExport(input({ captionTrackFile: 'captions.txt' })).args), /fps=/)
  assert.match(graph(planExport(input({ fps: 30 })).args), /,fps=30,setparams=/)
})

test('planExport carries the audio shape into both the format and the silence', () => {
  const plan = planExport(
    input({
      clips: [clip(), clip({ path: '/media/b.mp4', hasAudio: false })],
      audio: { channels: 1, sampleRate: 44_100 }
    })
  )
  assert.match(graph(plan.args), /\[0:a\]aformat=[^[]*sample_rates=44100[^[]*channel_layouts=mono/)
  assert.match(graph(plan.args), /anullsrc=channel_layout=mono:sample_rate=44100/)
})

test('planExport names the container, so the output extension need not', () => {
  // The app renders to `<target>.part`, which ffmpeg cannot pick a muxer from:
  // without `-f mp4` it fails before writing a frame ("Unable to choose an
  // output format").
  for (const captionTrackFile of [null, 'captions.txt']) {
    const args = planExport(input({ captionTrackFile, outputPath: '/out/film.mp4.part' })).args
    assert.deepEqual(args.slice(-3), ['-f', 'mp4', '/out/film.mp4.part'])
  }
})

test('planExport renders as soon as there is something to burn', () => {
  const plan = planExport(input({ captionTrackFile: 'captions.txt' }))
  assert.equal(plan.reencodes, true)
  assert.match(
    graph(plan.args),
    /\[1:v\]format=rgba,setsar=1\[caps\];\[v0\]\[caps\]overlay=0:0:format=auto:shortest=1/
  )
  assert.deepEqual(plan.args.slice(plan.args.indexOf('-map'), plan.args.indexOf('-map') + 4), [
    '-map',
    '[vout]',
    '-map',
    '[a0]'
  ])
})

test('planExport renders more than one clip even with nothing to burn', () => {
  const plan = planExport(input({ clips: [clip(), clip({ path: '/media/b.mp4' })] }))
  assert.equal(plan.reencodes, true)
  assert.match(graph(plan.args), /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[vcat\]\[acat\]/)
  // Nothing to burn, so the concat output is what gets mapped.
  assert.doesNotMatch(graph(plan.args), /overlay=/)
  assert.deepEqual(plan.args.slice(plan.args.indexOf('-map'), plan.args.indexOf('-map') + 4), [
    '-map',
    '[vcat]',
    '-map',
    '[acat]'
  ])
})

test('planExport fits every input to the canvas without cropping it', () => {
  const plan = planExport(
    input({
      clips: [clip(), clip({ path: '/media/b.mp4' })],
      frame: { width: 1280, height: 720 }
    })
  )
  for (const index of [0, 1]) {
    // Colour is asserted separately below; this is about the geometry.
    assert.match(
      graph(plan.args),
      new RegExp(
        `\\[${index}:v\\]scale=1280:720:force_original_aspect_ratio=decrease[^,]*,` +
          `pad=1280:720:\\(ow-iw\\)/2:\\(oh-ih\\)/2,setsar=1,format=yuv420p`
      )
    )
  }
})

test('planExport both converts the colour and labels it', () => {
  const chain = graph(planExport(input({ captionTrackFile: 'captions.txt' })).args)
  // Converting without labelling leaves a file nobody can identify, and the
  // muxer writes no `colr` atom until all three of primaries, transfer and
  // matrix are known — an untagged export is what every player guesses at.
  assert.match(chain, /out_color_matrix=bt709/)
  assert.match(chain, /out_range=tv/)
  assert.match(chain, /setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv/)
})

test('planExport gives a silent clip a silence of exactly its own length', () => {
  const plan = planExport(
    input({
      clips: [clip(), clip({ path: '/media/b.mp4', durationMs: 2500, hasAudio: false })]
    })
  )
  assert.match(graph(plan.args), /anullsrc=channel_layout=stereo:sample_rate=48000:d=2\.5,/)
  assert.match(graph(plan.args), /\[0:a\]aformat=/)
})

test('planExport burns after concatenating, so the captions run on one clock', () => {
  const plan = planExport(
    input({ clips: [clip(), clip({ path: '/media/b.mp4' })], captionTrackFile: 'captions.txt' })
  )
  assert.match(
    graph(plan.args),
    /concat=n=2:v=1:a=1\[vcat\]\[acat\];\[2:v\]format=rgba,setsar=1\[caps\];\[vcat\]\[caps\]overlay=/
  )
})

test('planExport passes the codec arguments through untouched', () => {
  const plan = planExport(
    input({
      captionTrackFile: 'captions.txt',
      videoArgs: ['-c:v', 'h264_mf'],
      audioArgs: ['-c:a', 'aac']
    })
  )
  const joined = plan.args.join(' ')
  assert.match(joined, /-c:v h264_mf -c:a aac -movflags \+faststart/)
})

test('planExport always asks for the machine-readable progress feed', () => {
  for (const plan of [
    planExport(input()),
    planExport(input({ captionTrackFile: 'captions.txt' }))
  ]) {
    assert.deepEqual(plan.args.slice(0, 5), [
      '-y',
      '-hide_banner',
      '-nostats',
      '-progress',
      'pipe:1'
    ])
  }
})

test('planExport totals the timeline whichever shape it takes', () => {
  assert.equal(planExport(input()).totalDurationMs, 5000)
  assert.equal(
    planExport(input({ clips: [clip(), clip({ durationMs: 1500 })] })).totalDurationMs,
    6500
  )
})

test('planExport ends the film with the picture, not with the caption track', () => {
  // The track is built to outlast the picture on purpose, so `overlay` has to be
  // told to stop at the shorter input — otherwise the export gains the track's
  // tail as a frozen frame (see export.md).
  const chain = graph(planExport(input({ captionTrackFile: 'captions.txt' })).args)
  assert.match(chain, /overlay=[^;]*shortest=1/)
})
