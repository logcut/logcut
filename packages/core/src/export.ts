import type { AssLine } from './ass.ts'
import type { Transcript } from './types.ts'

/** Where a clip sits on the timeline, and what it is made of. */
export interface ExportClip {
  path: string
  durationMs: number
  hasAudio: boolean
  /** The clip's own picture size, which is how the plan tells whether the
   *  canvas is asking for any change at all. */
  width: number
  height: number
}

/** Enough of a laid-out timeline to place one asset's captions on its clock. */
export interface CaptionClip {
  assetId: string
  startMs: number
}

export interface ExportInput {
  clips: ExportClip[]
  /** The picture every clip is fitted into, in pixels. */
  frame: { width: number; height: number }
  /** **A bare filename, never a path** — resolved against the `cwd` ffmpeg is
   *  spawned in. A filtergraph reads it through three levels of quoting where
   *  `:` and `\` are both syntax, so `C:\Users\…` is unspellable (export.md). */
  subtitleFile: string | null
  /** Codec arguments in full. **The core knows no encoder's name** — which ones
   *  exist is a fact about the machine doing the export. */
  videoArgs: string[]
  audioArgs: string[]
  /** Frames per second to normalize every clip to, or 0 to leave them alone. */
  fps: number
  audio: { channels: number; sampleRate: number }
  /** Leave the audio out of the file entirely. */
  videoOnly: boolean
  outputPath: string
}

export interface ExportPlan {
  args: string[]
  totalDurationMs: number
  /** False when the plan only remuxes, which finishes in about no time. */
  reencodes: boolean
}

/** Audio the concat filter can join: every input has to arrive in one shape. */
function audioFormat(audio: ExportInput['audio']): string {
  const layout = audio.channels === 1 ? 'mono' : 'stereo'
  return `aformat=sample_fmts=fltp:sample_rates=${audio.sampleRate}:channel_layouts=${layout}`
}

/** Every caption on the timeline, on the timeline's clock — an utterance is
 *  timed against its own asset, and the clip's offset is the difference. */
export function captionLinesFor(
  clips: CaptionClip[],
  transcripts: Readonly<Record<string, Transcript>>
): AssLine[] {
  const lines: AssLine[] = []
  for (const clip of clips) {
    for (const utterance of transcripts[clip.assetId]?.utterances ?? []) {
      lines.push({
        start: utterance.start + clip.startMs,
        end: utterance.end + clip.startMs,
        text: utterance.text,
        speakerId: utterance.speakerId,
        style: utterance.style
      })
    }
  }
  return lines
}

/**
 * The colour every export is delivered in: SDR Rec. 709 at limited range, which
 * is what an H.264 MP4 is taken to mean wherever it is played.
 *
 * **Stated, not inherited.** A source carrying no colour tags propagates none,
 * and an untagged file is one every player is entitled to guess at — the
 * guesses differ, so the same file plays back normal in one and oversaturated
 * in the next (see export.md).
 */
const COLOUR = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv' } as const

/**
 * Fit one input to the canvas without cropping it, then settle everything the
 * next stage refuses to settle for itself: sample aspect and pixel format,
 * which `concat` will not convert, and colour, which nothing downstream will
 * either state or convert.
 *
 * `scale` converts the matrix and the range; `setparams` is what labels the
 * result. **Both are needed and neither substitutes for the other** — converting
 * without labelling produces a file nobody can identify, and the muxer writes
 * no `colr` atom until all three of primaries, transfer and matrix are known.
 * The encoder's own `-color_*` options do not survive this: the frame
 * properties coming out of the filter chain win.
 */
function videoChain(index: number, frame: ExportInput['frame'], fps: number): string {
  const { width, height } = frame
  return (
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease` +
    `:in_color_matrix=auto:out_color_matrix=${COLOUR.matrix}` +
    `:in_range=auto:out_range=${COLOUR.range},` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,` +
    // Before `setparams`, so the labels are the last word on the frames that
    // actually leave. `fps` duplicates and drops frames to hit the rate; asking
    // for the rate a clip already runs at is a no-op.
    (fps > 0 ? `fps=${fps},` : '') +
    `setparams=color_primaries=${COLOUR.primaries}:color_trc=${COLOUR.transfer}` +
    `:colorspace=${COLOUR.matrix}:range=${COLOUR.range}[v${index}]`
  )
}

function audioChain(index: number, clip: ExportClip, audio: ExportInput['audio']): string {
  const format = audioFormat(audio)
  if (clip.hasAudio) return `[${index}:a]${format}[a${index}]`
  // A silent clip still owes concat an audio stream of exactly its own length,
  // or every clip after it plays against the wrong picture.
  const layout = audio.channels === 1 ? 'mono' : 'stereo'
  return (
    `anullsrc=channel_layout=${layout}:sample_rate=${audio.sampleRate}:` +
    `d=${clip.durationMs / 1000},${format}[a${index}]`
  )
}

/**
 * The ffmpeg command that turns this timeline into a file.
 *
 * **Builds arguments and runs nothing** — executing them belongs to the app,
 * which is also where the encoder names in `videoArgs` came from.
 *
 * Two shapes. With nothing to burn and a single clip the source already is the
 * export, so it is remuxed rather than re-encoded: instant, and lossless in a
 * way no encoder setting can match. Everything else is rendered.
 */
export function planExport(input: ExportInput): ExportPlan {
  const { clips, frame, subtitleFile, fps, audio, videoOnly, outputPath } = input
  const totalDurationMs = clips.reduce((total, clip) => total + clip.durationMs, 0)

  // `-progress pipe:1` is the machine-readable feed the app follows. stderr
  // carries the same numbers, but as `\r`-terminated redraws that arrive split
  // across chunk boundaries — parseable, but only just.
  const head = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1']

  // ffmpeg picks the container from the output's extension, and the app writes
  // to `<target>.part` so a half-finished render never looks like a film — an
  // extension ffmpeg has never heard of. Saying the format outright is what
  // lets the caller name the file whatever it needs to.
  const tail = ['-movflags', '+faststart', '-f', 'mp4', outputPath]

  // Remux only when the export asks for nothing the source does not already
  // provide. Every condition here is something that, if ignored, would hand
  // back a file that quietly disagrees with what the dialog said.
  const lone = clips.length === 1 ? clips[0] : null
  if (
    subtitleFile === null &&
    lone !== null &&
    fps === 0 &&
    lone.width === frame.width &&
    lone.height === frame.height
  ) {
    return {
      // `-an` rather than a re-encode: dropping a track needs no decoder.
      args: [...head, '-i', lone.path, '-c', 'copy', ...(videoOnly ? ['-an'] : []), ...tail],
      totalDurationMs,
      reencodes: false
    }
  }

  const chains = clips.flatMap((clip, index) => [
    videoChain(index, frame, fps),
    ...(videoOnly ? [] : [audioChain(index, clip, audio)])
  ])

  let videoOut = '[v0]'
  let audioOut = '[a0]'
  if (clips.length > 1) {
    const inputs = clips
      .map((_, index) => (videoOnly ? `[v${index}]` : `[v${index}][a${index}]`))
      .join('')
    chains.push(
      `${inputs}concat=n=${clips.length}:v=1:a=${videoOnly ? 0 : 1}` +
        (videoOnly ? '[vcat]' : '[vcat][acat]')
    )
    videoOut = '[vcat]'
    audioOut = '[acat]'
  }
  if (subtitleFile !== null) {
    chains.push(`${videoOut}ass=${subtitleFile}[vout]`)
    videoOut = '[vout]'
  }

  return {
    args: [
      ...head,
      ...clips.flatMap((clip) => ['-i', clip.path]),
      '-filter_complex',
      chains.join(';'),
      '-map',
      videoOut,
      ...(videoOnly ? [] : ['-map', audioOut]),
      ...input.videoArgs,
      ...(videoOnly ? [] : input.audioArgs),
      ...tail
    ],
    totalDurationMs,
    reencodes: true
  }
}
