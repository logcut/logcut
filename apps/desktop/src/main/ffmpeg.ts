import type { ExportCodec } from '@logcut/core'
import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { FILMSTRIP_FRAMES } from '../shared/media'

export type FfmpegSource = 'bundled' | 'vendor' | 'system'

/** Both sidecars are built and shipped together; see scripts/build-ffmpeg-*.sh. */
type SidecarName = 'ffmpeg' | 'ffprobe'

function executableName(name: SidecarName): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/**
 * Locate one of the sidecar binaries.
 * Packaged builds must use the bundled LGPL sidecars and never fall back to PATH.
 * Development falls back to the system binary (usually a GPL build) with a warning.
 */
function resolveBinary(name: SidecarName): { binary: string; source: FfmpegSource } {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'ffmpeg', executableName(name))
    if (!fs.existsSync(bundled)) {
      throw new Error(`Bundled ${name} is missing; the application package is broken`)
    }
    return { binary: bundled, source: 'bundled' }
  }

  const vendor = path.join(
    app.getAppPath(),
    'vendor',
    'ffmpeg',
    `${process.platform}-${process.arch}`,
    executableName(name)
  )
  if (fs.existsSync(vendor)) {
    return { binary: vendor, source: 'vendor' }
  }

  console.warn(
    `[ffmpeg] Using system ${name} from PATH (dev only, likely a GPL build — never ship this)`
  )
  return { binary: executableName(name), source: 'system' }
}

export function resolveFfmpeg(): { binary: string; source: FfmpegSource } {
  return resolveBinary('ffmpeg')
}

export function resolveFfprobe(): { binary: string; source: FfmpegSource } {
  return resolveBinary('ffprobe')
}

/**
 * stdout is only piped when the caller wants it: ffprobe reports on stdout,
 * while ffmpeg writes its output to a file and would otherwise fill a pipe
 * nobody drains.
 */
function run(
  binary: string,
  args: string[],
  options: { captureStdout?: boolean } = {}
): Promise<string> {
  const label = path.basename(binary)
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe']
    })
    let stdout = ''
    let stderrTail = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    child.on('error', (error) => reject(new Error(`Failed to start ${label}: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${label} exited with code ${code}:\n${stderrTail}`))
    })
  })
}

function runFfmpeg(args: string[]): Promise<string> {
  return run(resolveFfmpeg().binary, args)
}

/** The encoders this app can drive, per codec, in preference order. **All
 *  hardware** — the sidecars are `--disable-gpl`, so there is no software
 *  encoder to fall back to, and which of these exists is a property of the
 *  build rather than the platform (see ffmpeg.md). */
const ENCODERS: Record<ExportCodec, string[]> = {
  h264: ['h264_videotoolbox', 'h264_mf'],
  hevc: ['hevc_videotoolbox', 'hevc_mf']
}

let encoders: Promise<Set<string>> | null = null

/** Every encoder the sidecar was built with. **The promise is cached rather
 *  than the value**, so concurrent callers at startup share one process. */
function availableEncoders(): Promise<Set<string>> {
  // **`captureStdout` is the whole of this working**: `-encoders` reports on
  // stdout, which `run` throws away unless asked. Without it the list comes back
  // empty, every encoder looks absent, and the export button goes quietly dead
  // the moment a project has captions to burn — this shipped once (ffmpeg.md).
  encoders ??= run(resolveFfmpeg().binary, ['-hide_banner', '-encoders'], { captureStdout: true })
    .then((output) => {
      const names = new Set(
        output
          .split('\n')
          // Anchored to a lowercase start so the legend above the list
          // (` V..... = Video`) does not parse as an encoder named `=`.
          .map((line) => /^\s[A-Z.]{6}\s+([a-z0-9][\w-]*)/.exec(line)?.[1])
          .filter((name): name is string => name !== undefined)
      )
      // **An empty list is not a build without encoders** — every ffmpeg has
      // some. It means the output was not read, and the only symptom downstream
      // is a disabled button with a misleading reason on it.
      if (names.size === 0) console.warn('[ffmpeg] Encoder list came back empty')
      return names
    })
    .catch((error: unknown) => {
      console.warn('[ffmpeg] Could not list encoders:', error)
      return new Set<string>()
    })
  return encoders
}

/** The encoder to render this codec with, or null when this build has none. */
export async function videoEncoder(codec: ExportCodec): Promise<string | null> {
  const available = await availableEncoders()
  return ENCODERS[codec].find((name) => available.has(name)) ?? null
}

/** Which codecs this build can actually produce. Empty on a build with no
 *  hardware encoder at all, which today means Linux. */
export async function availableCodecs(): Promise<ExportCodec[]> {
  const available = await availableEncoders()
  return (Object.keys(ENCODERS) as ExportCodec[]).filter((codec) =>
    ENCODERS[codec].some((name) => available.has(name))
  )
}

export interface FfmpegRun {
  /** Resolves when ffmpeg finished or was cancelled; rejects when it failed. */
  done: Promise<{ cancelled: boolean }>
  cancel(): void
}

interface ProgressOptions {
  /**
   * Working directory. The export sets this to the directory holding the
   * subtitle file so the filtergraph can name it without a path — see
   * packages/core/src/export.ts.
   */
  cwd: string
  totalDurationMs: number
  /** Called with a percentage that only ever goes up. */
  onProgress(percent: number): void
}

/** Run ffmpeg for long enough that somebody wants to watch it, or stop it.
 *  **Separate from `run` rather than an option on it** — this one keeps the
 *  child so it can be killed, and reads stdout as a live feed. */
export function runFfmpegProgress(args: string[], options: ProgressOptions): FfmpegRun {
  const { binary } = resolveFfmpeg()
  const label = path.basename(binary)
  const child = spawn(binary, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })

  let cancelled = false
  let percent = 0
  let pending = ''
  let stderrTail = ''

  child.stdout.on('data', (chunk: Buffer) => {
    // **Line-buffered by hand**: a chunk boundary lands wherever it lands, so
    // the tail after the last newline is the start of a line, not a line, and
    // reading it as one yields a truncated number.
    const text = pending + chunk.toString()
    const lines = text.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const match = /^out_time_us=(\d+)$/.exec(line.trim())
      if (!match || options.totalDurationMs <= 0) continue
      const next = (Number(match[1]) / 1000 / options.totalDurationMs) * 100
      // Never backwards: ffmpeg's reported time dips around a segment
      // boundary, and a progress bar that retreats reads as a fault.
      percent = Math.min(100, Math.max(percent, next))
      options.onProgress(percent)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })

  const done = new Promise<{ cancelled: boolean }>((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`Failed to start ${label}: ${error.message}`)))
    child.on('close', (code) => {
      // A killed ffmpeg exits with a null code and a signal, which is
      // indistinguishable from a crash unless the kill is remembered.
      if (cancelled) resolve({ cancelled: true })
      else if (code === 0) resolve({ cancelled: false })
      else reject(new Error(`${label} exited with code ${code}:\n${stderrTail}`))
    })
  })

  return {
    done,
    cancel: () => {
      cancelled = true
      child.kill()
    }
  }
}

/**
 * Extract the audio track as 16 kHz mono MP3 for ASR upload.
 * Returns the temp file path; the caller is responsible for deleting it.
 */
export async function extractAudio(videoPath: string): Promise<string> {
  const tempDir = path.join(app.getPath('temp'), 'logcut')
  fs.mkdirSync(tempDir, { recursive: true })
  const hash = crypto.createHash('sha1').update(videoPath).digest('hex').slice(0, 16)
  const outputPath = path.join(tempDir, `${hash}.mp3`)
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '48k',
    outputPath
  ])
  return outputPath
}

export interface MediaProbe {
  /** Container duration. Distinct from Transcript.audioDurationMs, which the
   *  ASR reports after decoding and which differs by tens of milliseconds. */
  durationMs: number
  width?: number
  height?: number
  hasVideo: boolean
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
}

interface FfprobeOutput {
  format?: { duration?: string }
  streams?: FfprobeStream[]
}

/**
 * Read duration and dimensions from the container.
 * Throws when the file cannot be probed — callers on the import path must
 * degrade to a zero duration rather than reject the file.
 */
export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const stdout = await run(
    resolveFfprobe().binary,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { captureStdout: true }
  )
  const probe = JSON.parse(stdout) as FfprobeOutput
  const streams = probe.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const seconds = Number(probe.format?.duration)
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    width: video?.width,
    height: video?.height,
    hasVideo: video !== undefined,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio')
  }
}

/** The height each filmstrip frame is scaled to; the count is shared. */
const STRIP_HEIGHT = 64

/**
 * A row of evenly spaced frames, tiled into one wide JPEG for the timeline's
 * media track. One image rather than N keeps it to a single ffmpeg call and a
 * single request from the renderer, which then addresses individual frames
 * inside the sheet by background-position.
 *
 * `-skip_frame nokey` is what makes this affordable: decoding every frame of a
 * 1.7 GB file to sample 40 of them took 20s, keyframes only takes 6s.
 *
 * The sampling is `fps` rather than a `select` on keyframe spacing, because
 * `tile` pads a short tile out with black: a file whose keyframes are sparser
 * than the interval yielded fewer than 40 frames and the strip ended in a
 * black tail covering the last fifth of the clip. `fps` duplicates the nearest
 * keyframe instead, so the row always holds exactly FILMSTRIP_FRAMES frames —
 * which the renderer relies on to work out where any one of them sits.
 */
export async function extractFilmstrip(
  filePath: string,
  durationMs: number,
  outPath: string
): Promise<void> {
  if (durationMs <= 0) throw new Error('Cannot build a filmstrip without a duration')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const rate = FILMSTRIP_FRAMES / (durationMs / 1000)
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-skip_frame',
    'nokey',
    '-i',
    filePath,
    '-vf',
    `fps=${rate.toFixed(6)},scale=-1:${STRIP_HEIGHT},tile=${FILMSTRIP_FRAMES}x1`,
    '-frames:v',
    '1',
    outPath
  ])
}

/**
 * The generation parameters, as a number.
 *
 * Bump it after changing anything below — how the waveform is sampled or
 * stored, the filmstrip's frame count, where the poster is taken from. Assets carry the
 * version they were built with, and a project opened with an older one rebuilds
 * itself in the background (see media-import.ts).
 *
 * **One number for all three pictures**, so changing only the waveform rebuilds
 * the poster and the filmstrip too. Three separate numbers would be exact, at
 * the price of three fields and three comparisons — and this changes rarely,
 * while the rebuild is a background task that interrupts nothing.
 */
export const ARTWORK_VERSION = 5

/**
 * The rate the waveform is stored at, and **what is stored is the audio
 * itself** — one byte per sample, its magnitude scaled to 0–255 — not a peak
 * per window.
 *
 * That distinction is the whole look of the thing. A window's peak is a
 * statistic, and neighbouring windows barely differ: measured over speech, two
 * adjacent 1ms peaks were a third of a pixel apart in a 16px strip. It draws a
 * smooth envelope, which is what a peak *is*, and reads as a volume curve.
 * Real samples swing either side of zero from one to the next, and that is
 * where the grain of a waveform comes from.
 *
 * 2kHz, downsampled by ffmpeg so it is low-passed rather than aliased. Speech
 * lives under 1kHz, so the shape survives; 8kHz keeps more grain at 28MB an
 * hour, against 7MB here. Below 2kHz the swing starts flattening out again.
 *
 * The renderer takes the loudest sample in a column when zoomed out, so the
 * envelope is still right at any width — a statistic can be computed from
 * samples, but samples cannot be recovered from a statistic, which is why this
 * is the side of the trade to store.
 */
export const WAVEFORM_SAMPLE_RATE = 2000

/**
 * The audio as bytes: magnitude per sample, at `WAVEFORM_SAMPLE_RATE`.
 *
 * ffmpeg decodes and downsamples to raw mono PCM on stdout and the magnitudes
 * are taken here, in a stream: the whole decode of a long file never exists in
 * memory at once, only the chunk being walked.
 *
 * Rejects when the file has no audio track, which the caller treats as any
 * other artwork failure.
 */
export async function extractWaveform(filePath: string, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const { binary } = resolveFfmpeg()
  const child = spawn(
    binary,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(WAVEFORM_SAMPLE_RATE),
      '-f',
      's16le',
      '-'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (text: string) => {
    stderr += text
  })

  const magnitudes: number[] = []
  // s16le is two bytes per sample, and a chunk boundary lands mid-sample as
  // often as not — the odd byte waits here for the rest of its pair.
  let halfSample: number | null = null
  const take = (value: number): void => {
    magnitudes.push(Math.round((Math.abs(value) / 32768) * 255))
  }

  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      let at = 0
      if (halfSample !== null) {
        // s16le: the byte held over is the low half, the one arriving is the
        // high half. Swapping them mangles one sample per chunk boundary.
        take(((halfSample | (chunk[0] << 8)) << 16) >> 16)
        halfSample = null
        at = 1
      }
      for (; at + 1 < chunk.length; at += 2) take(chunk.readInt16LE(at))
      if (at < chunk.length) halfSample = chunk[at]
    }
  } catch (error) {
    child.kill()
    throw error
  }

  const code = await new Promise<number>((resolve) => child.on('close', resolve))
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.trim()}`)
  if (magnitudes.length === 0) throw new Error('no audio')

  fs.writeFileSync(outPath, Buffer.from(magnitudes))
}

/** Write a single frame as JPEG, for project cards. */
export async function extractPoster(
  filePath: string,
  atMs: number,
  outPath: string,
  maxWidth = 640
): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await runFfmpeg([
    '-y',
    '-hide_banner',
    // Seeking before -i makes ffmpeg jump to the nearest keyframe instead of
    // decoding everything up to that point: milliseconds rather than minutes
    // on a multi-gigabyte file.
    '-ss',
    (atMs / 1000).toFixed(3),
    '-i',
    filePath,
    '-frames:v',
    '1',
    // Without -update the image2 muxer warns that it expects a numbered
    // sequence rather than a single file.
    '-update',
    '1',
    // -2 keeps the height even, which the JPEG encoder requires.
    '-vf',
    `scale=${maxWidth}:-2`,
    outPath
  ])
}
