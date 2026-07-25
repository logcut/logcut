import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type FfmpegSource = 'bundled' | 'vendor' | 'system'

function sidecarName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

/**
 * Locate the ffmpeg binary.
 * Packaged builds must use the bundled LGPL sidecar and never fall back to PATH.
 * Development falls back to the system ffmpeg (usually a GPL build) with a warning.
 */
export function resolveFfmpeg(): { binary: string; source: FfmpegSource } {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'ffmpeg', sidecarName())
    if (!fs.existsSync(bundled)) {
      throw new Error('Bundled ffmpeg is missing; the application package is broken')
    }
    return { binary: bundled, source: 'bundled' }
  }

  const vendor = path.join(
    app.getAppPath(),
    'vendor',
    'ffmpeg',
    `${process.platform}-${process.arch}`,
    sidecarName()
  )
  if (fs.existsSync(vendor)) {
    return { binary: vendor, source: 'vendor' }
  }

  console.warn(
    '[ffmpeg] Using system ffmpeg from PATH (dev only, likely a GPL build — never ship this)'
  )
  return { binary: sidecarName(), source: 'system' }
}

function runFfmpeg(args: string[]): Promise<void> {
  const { binary } = resolveFfmpeg()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    child.on('error', (error) => reject(new Error(`Failed to start ffmpeg: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderrTail}`))
    })
  })
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
