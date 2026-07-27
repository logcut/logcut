import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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

/** Frames in a filmstrip, and the height each is scaled to. */
const FILMSTRIP_FRAMES = 40
const STRIP_HEIGHT = 64

/**
 * A row of evenly spaced frames, tiled into one wide JPEG for the timeline's
 * media track. One image rather than N keeps it to a single ffmpeg call and a
 * single request from the renderer, which then just stretches it to the track.
 *
 * `-skip_frame nokey` is what makes this affordable: decoding every frame of a
 * 1.7 GB file to sample 40 of them took 20s, keyframes only takes 6s. The
 * `select` expression is still needed on top — taking the first 40 keyframes
 * outright would cover only the opening minute of a densely-keyframed file.
 */
export async function extractFilmstrip(
  filePath: string,
  durationMs: number,
  outPath: string
): Promise<void> {
  if (durationMs <= 0) throw new Error('Cannot build a filmstrip without a duration')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const intervalSeconds = durationMs / 1000 / FILMSTRIP_FRAMES
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-skip_frame',
    'nokey',
    '-i',
    filePath,
    '-fps_mode',
    'passthrough',
    '-vf',
    `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${intervalSeconds.toFixed(3)})',` +
      `scale=-1:${STRIP_HEIGHT},tile=${FILMSTRIP_FRAMES}x1`,
    '-frames:v',
    '1',
    outPath
  ])
}

/**
 * The audio envelope as a white-on-transparent PNG, coloured by the renderer
 * with a CSS mask so it follows the theme.
 *
 * ffmpeg's showwavespic draws it directly — computing peaks here would mean
 * piping raw PCM through Node for no gain.
 */
export async function extractWaveform(filePath: string, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-filter_complex',
    `[0:a]aformat=channel_layouts=mono,showwavespic=s=2000x${STRIP_HEIGHT}:colors=white`,
    '-frames:v',
    '1',
    outPath
  ])
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
