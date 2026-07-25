import { configCacheKey, segmentTranscript, toSrt } from '@logcut/core'
import type { LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ExportSrtResult, OpenProjectResult, TranscribeProgress } from '../shared/ipc'
import { transcribeAudio } from './asr'
import { extractAudio } from './ffmpeg'
import { registerMediaPath } from './media'
import * as projects from './projects'
import * as settings from './settings'

/** Single registration point for every ipcMain handler. */
export function registerIpc(): void {
  ipcMain.handle('settings:get-status', () => settings.getStatus())
  ipcMain.handle('settings:set-api-key', (_event, key: string) => {
    settings.setApiKey(key)
  })

  ipcMain.handle('system:get-locale', () => app.getLocale())
  ipcMain.handle('settings:get-language', () => settings.getLanguageOption())
  ipcMain.handle('settings:set-language', (_event, option: LanguageOption) => {
    settings.setLanguageOption(option)
  })

  ipcMain.handle('media:register', (_event, videoPath: string) => registerMediaPath(videoPath))

  ipcMain.handle('dialog:pick-video', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle('export:srt', async (event, transcript: Transcript): Promise<ExportSrtResult> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const defaultName = `${path.parse(transcript.sourcePath).name}.srt`
    const options = {
      defaultPath: defaultName,
      filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return {}
    fs.writeFileSync(result.filePath, toSrt(transcript.utterances), 'utf8')
    return { savedPath: result.filePath }
  })

  ipcMain.handle(
    'transcribe:run',
    async (
      event,
      videoPath: string,
      force = false,
      config: TranscribeConfig = {}
    ): Promise<Transcript> => {
      const cacheKey = configCacheKey(config)
      if (!force) {
        const cached = projects.findFreshByVideoPath(videoPath, cacheKey)
        if (cached) return cached
      }

      const apiKey = settings.getApiKey()
      if (!apiKey) {
        throw new Error('API_KEY_MISSING: Configure the Volcano Engine API key in Settings first')
      }

      const sendProgress = (progress: TranscribeProgress): void => {
        if (!event.sender.isDestroyed()) event.sender.send('transcribe:progress', progress)
      }

      sendProgress({ phase: 'extracting' })
      const audioPath = await extractAudio(videoPath)
      try {
        sendProgress({ phase: 'transcribing' })
        const { transcript: rawTranscript, raw } = await transcribeAudio(
          audioPath,
          apiKey,
          videoPath,
          config
        )
        // Re-split long ASR utterances into subtitle-length lines before saving;
        // the untouched provider response is archived alongside as the rollback source.
        const transcript = segmentTranscript(rawTranscript)
        projects.saveProject(transcript, cacheKey, raw)
        return transcript
      } finally {
        fs.rm(audioPath, { force: true }, () => {})
      }
    }
  )

  ipcMain.handle('project:list', () => projects.listProjects())

  ipcMain.handle('project:open', (_event, id: string): OpenProjectResult => {
    const project = projects.loadProject(id)
    if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
    if (!fs.existsSync(project.videoPath)) {
      throw new Error(`VIDEO_MISSING: The video file was not found at ${project.videoPath}`)
    }
    return {
      transcript: project.transcript,
      mediaUrl: registerMediaPath(project.videoPath),
      stale: projects.isStale(project)
    }
  })

  ipcMain.handle('project:save', (_event, transcript: Transcript) => {
    projects.saveProject(transcript)
  })

  ipcMain.handle('project:delete', (_event, id: string) => {
    projects.deleteProject(id)
  })
}
