import {
  configCacheKey,
  DEFAULT_CAPTION_STYLES,
  DEFAULT_MAX_CHARS,
  parseVolcanoResponse,
  segmentTranscript,
  toSrt
} from '@logcut/core'
import type { CaptionStyles, LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ExportSrtResult,
  ImportMediaResult,
  MediaAssetSummary,
  ProjectDetail,
  TimelineClipSummary,
  ProjectSummary,
  ResplitResult,
  TranscribePhase,
  TranscribeResult,
  UpdateState
} from '../shared/ipc'
import { VIDEO_EXTENSIONS } from '../shared/media'
import { transcribeAudio } from './asr'
import { extractAudio } from './ffmpeg'
import { registerMediaPath } from './media'
import { importMedia } from './media-import'
import * as projects from './projects'
import * as settings from './settings'
import * as updater from './updater'

/** Registration requires the file to exist; a poster may not be written yet. */
function mediaUrlIfPresent(filePath: string): string | null {
  try {
    return registerMediaPath(filePath)
  } catch {
    return null
  }
}

function toSummary(project: projects.ProjectFile): ProjectSummary {
  // Falls back to the first asset: a card should show a poster as soon as
  // something has been imported, well before anything reaches the timeline.
  const firstClip = project.timeline[0]
  const active =
    project.assets.find((asset) => asset.id === firstClip?.assetId) ?? project.assets[0]
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    assetCount: project.assets.length,
    durationMs: project.assets.reduce((total, asset) => total + asset.durationMs, 0),
    thumbnailUrl: active?.thumbnail
      ? mediaUrlIfPresent(projects.thumbnailPath(project.id, active.thumbnail))
      : null
  }
}

function toAssetSummary(projectId: string, asset: projects.MediaAsset): MediaAssetSummary {
  const state = projects.assetState(asset)
  return {
    id: asset.id,
    fileName: asset.fileName,
    path: asset.path,
    kind: asset.kind,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    mediaUrl: state.missing ? '' : (mediaUrlIfPresent(asset.path) ?? ''),
    thumbnailUrl: asset.thumbnail
      ? mediaUrlIfPresent(projects.thumbnailPath(projectId, asset.thumbnail))
      : null,
    filmstripUrl: asset.filmstrip
      ? mediaUrlIfPresent(projects.thumbnailPath(projectId, asset.filmstrip))
      : null,
    waveformUrl: asset.waveform
      ? mediaUrlIfPresent(projects.waveformPath(projectId, asset.waveform))
      : null,
    missing: state.missing,
    stale: state.stale,
    transcriptStatus: asset.transcriptStatus
  }
}

/** Lay the clips end to end. A clip whose asset vanished contributes nothing. */
function toTimeline(project: projects.ProjectFile): TimelineClipSummary[] {
  const summaries: TimelineClipSummary[] = []
  let startMs = 0
  for (const clip of project.timeline) {
    const asset = project.assets.find((candidate) => candidate.id === clip.assetId)
    if (!asset) continue
    summaries.push({ id: clip.id, assetId: clip.assetId, startMs, durationMs: asset.durationMs })
    startMs += asset.durationMs
  }
  return summaries
}

function toDetail(project: projects.ProjectFile): ProjectDetail {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    timeline: toTimeline(project),
    assets: project.assets.map((asset) => toAssetSummary(project.id, asset)),
    // Resolved here so the renderer never has to know that older projects
    // simply have no such field.
    maxChars: project.maxChars ?? DEFAULT_MAX_CHARS,
    captionStyles: project.captionStyles ?? DEFAULT_CAPTION_STYLES
  }
}

function requireProject(projectId: string): projects.ProjectFile {
  const project = projects.loadProject(projectId)
  if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
  return project
}

function requireAsset(projectId: string, assetId: string): projects.MediaAsset {
  const asset = requireProject(projectId).assets.find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error('ASSET_MISSING: This media is no longer part of the project')
  return asset
}

/** Single registration point for every ipcMain handler. */
export function registerIpc(): void {
  // Window controls exist because macOS draws its traffic lights in the
  // renderer (see main/index.ts); on other platforms the native title bar
  // still owns these actions and the renderer never calls them.
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('window:minimize', (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  )
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    // Matches what the green button does on macOS: zoom, not maximize.
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle('settings:get-status', () => settings.getStatus())
  ipcMain.handle('settings:set-api-key', (_event, key: string) => {
    settings.setApiKey(key)
  })

  ipcMain.handle('system:get-locale', () => app.getLocale())
  ipcMain.handle('settings:get-language', () => settings.getLanguageOption())
  ipcMain.handle('settings:set-language', (_event, option: LanguageOption) => {
    settings.setLanguageOption(option)
  })

  ipcMain.handle('project:create', (_event, name?: string): ProjectSummary =>
    toSummary(projects.createProject(name))
  )

  ipcMain.handle('project:list', (): ProjectSummary[] => projects.listProjects().map(toSummary))

  ipcMain.handle('project:open', (_event, projectId: string): ProjectDetail =>
    toDetail(requireProject(projectId))
  )

  ipcMain.handle('project:rename', (_event, projectId: string, name: string): ProjectDetail => {
    const project = projects.renameProject(projectId, name)
    if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
    return toDetail(project)
  })

  ipcMain.handle('project:delete', (_event, projectId: string) => {
    projects.deleteProject(projectId)
  })

  ipcMain.handle('dialog:pick-media', async (event): Promise<string[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [
        { name: 'Video', extensions: VIDEO_EXTENSIONS.map((extension) => extension.slice(1)) }
      ]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(
    'media:import',
    async (_event, projectId: string, paths: string[]): Promise<ImportMediaResult> => {
      const outcome = await importMedia(projectId, paths)
      if (!outcome) throw new Error('PROJECT_MISSING: This project no longer exists')
      return { project: toDetail(outcome.project), rejected: outcome.rejected }
    }
  )

  ipcMain.handle('media:remove', (_event, projectId: string, assetId: string): ProjectDetail => {
    const project = projects.removeAsset(projectId, assetId)
    if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
    return toDetail(project)
  })

  ipcMain.handle(
    'timeline:add-clip',
    (_event, projectId: string, assetId: string): ProjectDetail => {
      const project = projects.addTimelineClip(projectId, assetId)
      if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
      return toDetail(project)
    }
  )

  ipcMain.handle(
    'timeline:set',
    (_event, projectId: string, clips: projects.TimelineClip[]): ProjectDetail => {
      const project = projects.setTimeline(projectId, clips)
      if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
      return toDetail(project)
    }
  )

  ipcMain.handle(
    'timeline:remove-clip',
    (_event, projectId: string, clipId: string): ProjectDetail => {
      const project = projects.removeTimelineClip(projectId, clipId)
      if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
      return toDetail(project)
    }
  )

  ipcMain.handle(
    'transcript:get',
    (_event, projectId: string, assetId: string): Transcript | null =>
      projects.loadTranscript(projectId, assetId)
  )

  ipcMain.handle(
    'transcript:save',
    (_event, projectId: string, assetId: string, transcript: Transcript) => {
      projects.saveTranscript(projectId, assetId, transcript)
    }
  )

  /**
   * Change the subtitle line length and re-split every transcript that can be,
   * without going near the network.
   *
   * **Re-splitting starts from the archived provider response, never from the
   * stored transcript** — see projects.md `loadRaw` for why the stored one
   * cannot answer. Assets with no archive keep the subtitles they have and are
   * reported back so the UI can name them.
   */
  ipcMain.handle(
    'project:setCaptionStyles',
    (_event, projectId: string, styles: CaptionStyles): ProjectDetail => {
      const project = projects.setCaptionStyles(projectId, styles)
      if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')
      return toDetail(project)
    }
  )

  ipcMain.handle(
    'transcript:setMaxChars',
    (_event, projectId: string, maxChars: number): ResplitResult => {
      const project = projects.setMaxChars(projectId, maxChars)
      if (!project) throw new Error('PROJECT_MISSING: This project no longer exists')

      const transcripts: Record<string, Transcript> = {}
      const skipped: string[] = []
      for (const asset of project.assets) {
        if (asset.transcriptStatus !== 'ready') continue
        const raw = projects.loadRaw(projectId, asset.id)
        if (raw === null) {
          skipped.push(asset.id)
          continue
        }
        const transcript = segmentTranscript(parseVolcanoResponse(raw), {
          maxChars: project.maxChars
        })
        projects.saveTranscript(projectId, asset.id, transcript, { immediate: true })
        transcripts[asset.id] = transcript
      }
      return { project: toDetail(project), transcripts, skipped }
    }
  )

  ipcMain.handle(
    'transcript:transcribe',
    async (
      event,
      projectId: string,
      assetId: string,
      options: { force?: boolean; config?: TranscribeConfig } = {}
    ): Promise<TranscribeResult> => {
      const asset = requireAsset(projectId, assetId)
      const config = options.config ?? {}
      const cacheKey = configCacheKey(config)

      if (!options.force && projects.canReuseTranscript(asset, cacheKey)) {
        const cached = projects.loadTranscript(projectId, assetId)
        if (cached) return { transcript: cached, fromCache: true }
      }

      const apiKey = settings.getApiKey()
      if (!apiKey) {
        throw new Error('API_KEY_MISSING: Configure the Volcano Engine API key in Settings first')
      }

      const sendProgress = (phase: TranscribePhase): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('transcribe:progress', { projectId, assetId, phase })
        }
      }

      sendProgress('extracting')
      const audioPath = await extractAudio(asset.path)
      try {
        sendProgress('transcribing')
        const { transcript: rawTranscript, raw } = await transcribeAudio(audioPath, apiKey, config)
        // Re-split long ASR utterances into subtitle-length lines before saving,
        // at this project's line length. The untouched provider response is
        // archived alongside so the length can be changed later without paying
        // for another transcription (see 'transcript:setMaxChars').
        const transcript = segmentTranscript(rawTranscript, {
          maxChars: requireProject(projectId).maxChars ?? DEFAULT_MAX_CHARS
        })
        projects.saveTranscript(projectId, assetId, transcript, { immediate: true })
        projects.saveRaw(projectId, assetId, raw)
        projects.updateAsset(projectId, assetId, {
          transcriptStatus: 'ready',
          transcriptConfigKey: cacheKey,
          hasRaw: true,
          rawProvider: 'volcano'
        })
        return { transcript, fromCache: false }
      } catch (error) {
        // Persisted so a crash or a closed window leaves the asset showing
        // "failed, retry" instead of looking like it was never attempted.
        projects.updateAsset(projectId, assetId, { transcriptStatus: 'failed' })
        throw error
      } finally {
        fs.rm(audioPath, { force: true }, () => {})
      }
    }
  )

  ipcMain.handle(
    'export:srt',
    async (event, projectId: string, assetId: string): Promise<ExportSrtResult> => {
      const asset = requireAsset(projectId, assetId)
      const transcript = projects.loadTranscript(projectId, assetId)
      if (!transcript) throw new Error('TRANSCRIPT_MISSING: Recognize the subtitles first')

      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        defaultPath: `${path.parse(asset.fileName).name}.srt`,
        filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }]
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return {}
      fs.writeFileSync(result.filePath, toSrt(transcript.utterances), 'utf8')
      return { savedPath: result.filePath }
    }
  )

  ipcMain.handle('app:get-version', (): string => app.getVersion())
  ipcMain.handle('update:get-state', (): UpdateState => updater.updateState())
  ipcMain.handle('update:check', (): Promise<void> => updater.checkForUpdates())
  ipcMain.handle('update:install', (): void => updater.installUpdate())
}
