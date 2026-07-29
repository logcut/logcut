import {
  captionLinesFor,
  DEFAULT_CAPTION_STYLES,
  DEFAULT_EXPORT_SETTINGS,
  deriveBitrateKbps,
  planExport,
  toAss
} from '@logcut/core'
import type { ExportSettings, Transcript } from '@logcut/core'
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ExportVideoResult } from '../shared/ipc'
import { probeMedia, runFfmpegProgress, videoEncoder } from './ffmpeg'
import type { FfmpegRun } from './ffmpeg'
import * as projects from './projects'

/**
 * What `SYSTEM_FONT` becomes on the way into the picture.
 *
 * libass takes one family name, not a stack, so the CJK entry of the renderer's
 * font stack is the one to pick: transcripts here are largely Chinese, and a
 * face without those glyphs would burn in as empty boxes. Latin text renders
 * from these families too, so nothing is lost by choosing for the harder case.
 */
const SYSTEM_FONTS: Record<string, string> = {
  darwin: 'PingFang SC',
  win32: 'Microsoft YaHei'
}
const DEFAULT_SYSTEM_FONT = 'Noto Sans CJK SC'

/** The canvas when the first clip could not be probed at all. */
const FALLBACK_FRAME = { width: 1920, height: 1080 }

/**
 * Everything the encoder is told, from the settings and the canvas.
 *
 * The bitrate is derived from the canvas when the user has not typed one, which
 * is the default: a number chosen for 1080p is the wrong number for 4K, and the
 * dialog shows the derived value rather than leaving the field empty.
 */
function videoArgsFor(
  encoder: string,
  settings: ExportSettings,
  frame: { width: number; height: number }
): string[] {
  const bitrate =
    settings.videoBitrateKbps > 0
      ? settings.videoBitrateKbps
      : deriveBitrateKbps(frame.width, frame.height, settings.quality, settings.codec)
  return [
    '-c:v',
    encoder,
    '-b:v',
    `${bitrate}k`,
    // VideoToolbox has no hardware encoder in every virtual machine and on some
    // older hardware; without this it fails there instead of encoding slower.
    ...(encoder.endsWith('_videotoolbox') ? ['-allow_sw', '1'] : []),
    // HEVC in MP4 has two tags, and Apple's players only accept this one. The
    // default `hev1` produces a file that plays everywhere except the platform
    // most likely to be asked to play it.
    ...(settings.codec === 'hevc' ? ['-tag:v', 'hvc1'] : [])
  ]
}

let current: FfmpegRun | null = null

/** Stop the export in flight, if there is one. Nothing to do if there is not. */
export function cancelExport(): void {
  current?.cancel()
}

/**
 * Render the project's timeline to `targetPath`.
 *
 * **The export is the timeline as it plays**: every caption the preview would
 * draw is burned in, which is also why a project carrying captions cannot be
 * exported by a build with no encoder — there is no lossless path that still
 * produces the right picture (see export.md).
 */
export async function exportVideo(
  projectId: string,
  targetPath: string,
  onProgress: (percent: number) => void
): Promise<ExportVideoResult> {
  const project = projects.loadProject(projectId)
  if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')

  const laid = project.timeline.flatMap((clip) => {
    const asset = project.assets.find((candidate) => candidate.id === clip.assetId)
    return asset ? [{ clipId: clip.id, asset }] : []
  })
  if (laid.length === 0) throw new Error('TIMELINE_EMPTY: Add a clip to the timeline first')

  const missing = laid.find(({ asset }) => !fs.existsSync(asset.path))
  if (missing) {
    throw new Error(`MEDIA_MISSING: ${missing.asset.fileName} is no longer where it was imported`)
  }

  // Probed now rather than read from the project record: the record has no
  // audio flag at all, and a file may have been replaced since it was imported.
  const probes = await Promise.all(laid.map(({ asset }) => probeMedia(asset.path)))
  const clips = laid.map(({ asset }, index) => ({
    path: asset.path,
    durationMs: probes[index].durationMs,
    hasAudio: probes[index].hasAudio,
    width: probes[index].width ?? FALLBACK_FRAME.width,
    height: probes[index].height ?? FALLBACK_FRAME.height
  }))

  const settings = project.exportSettings ?? DEFAULT_EXPORT_SETTINGS
  // A canvas of 0 × 0 means "follow the first clip", which is also the fallback
  // when that clip could not be probed at all.
  const frame =
    settings.width > 0 && settings.height > 0
      ? { width: settings.width, height: settings.height }
      : { width: clips[0].width, height: clips[0].height }

  let startMs = 0
  const captionClips = laid.map(({ asset }, index) => {
    const placed = { assetId: asset.id, startMs }
    startMs += probes[index].durationMs
    return placed
  })
  const transcripts: Record<string, Transcript> = {}
  for (const { asset } of laid) {
    const transcript = projects.loadTranscript(projectId, asset.id)
    if (transcript) transcripts[asset.id] = transcript
  }
  const lines = captionLinesFor(captionClips, transcripts)

  const encoder = await videoEncoder(settings.codec)
  if (lines.length > 0 && encoder === null) {
    throw new Error('NO_ENCODER: This build has no video encoder, so captions cannot be burned in')
  }

  // Both the subtitle file and ffmpeg's working directory. A bare filename is
  // the only form that survives a filtergraph unescaped — see export.ts in the
  // core for why that matters more than it sounds like it should.
  const workDir = path.join(app.getPath('temp'), 'logcut')
  fs.mkdirSync(workDir, { recursive: true })
  const subtitleFile =
    lines.length > 0
      ? `${crypto.createHash('sha1').update(`${projectId}:${targetPath}`).digest('hex').slice(0, 16)}.ass`
      : null

  if (subtitleFile) {
    fs.writeFileSync(
      path.join(workDir, subtitleFile),
      toAss({
        lines,
        styles: project.captionStyles ?? DEFAULT_CAPTION_STYLES,
        frame,
        systemFont: SYSTEM_FONTS[process.platform] ?? DEFAULT_SYSTEM_FONT
      }),
      'utf8'
    )
  }

  // Written beside the target so the rename cannot cross a device, and so a
  // failed or cancelled export leaves nothing that looks like a finished film.
  const partPath = `${targetPath}.part`
  const plan = planExport({
    clips,
    frame,
    subtitleFile,
    videoArgs: encoder === null ? [] : videoArgsFor(encoder, settings, frame),
    audioArgs: ['-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`],
    fps: settings.fps,
    audio: { channels: settings.audioChannels, sampleRate: settings.audioSampleRate },
    videoOnly: settings.videoOnly,
    outputPath: partPath
  })

  // The renderer opens its progress dialog on this, not on the call returning:
  // everything above happens behind a native save dialog, and until that is
  // dismissed there is nothing to show progress for.
  onProgress(0)
  const run = runFfmpegProgress(plan.args, {
    cwd: workDir,
    totalDurationMs: plan.totalDurationMs,
    onProgress
  })
  current = run
  try {
    const { cancelled } = await run.done
    if (cancelled) {
      fs.rmSync(partPath, { force: true })
      return { cancelled: true }
    }
    fs.renameSync(partPath, targetPath)
    return { savedPath: targetPath }
  } catch (error) {
    fs.rmSync(partPath, { force: true })
    throw error
  } finally {
    current = null
    if (subtitleFile) fs.rm(path.join(workDir, subtitleFile), { force: true }, () => {})
  }
}
