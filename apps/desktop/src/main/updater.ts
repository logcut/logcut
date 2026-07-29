import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/ipc'

/** Auto update against the GitHub release. **Nothing here works in
 *  development** — an unpacked app has no app-update.yml and every call throws,
 *  so the state is pinned to 'unsupported' rather than left idle (see
 *  updater.md). */

const SUPPORTED = app.isPackaged

/**
 * Long enough to be past window creation and the first project load. The check
 * is a network round trip and the download that may follow is the whole app;
 * neither should compete with getting something on screen.
 */
const FIRST_CHECK_DELAY_MS = 20_000

let state: UpdateState = SUPPORTED ? { kind: 'idle' } : { kind: 'unsupported' }

function publish(next: UpdateState): void {
  state = next
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('update:state', next)
    }
  }
}

/** The renderer asks for this on mount: it may open long after a check ran. */
export function updateState(): UpdateState {
  return state
}

export function registerUpdater(): void {
  if (!SUPPORTED) return

  // Downloading without being asked is the point — by the time the user opens
  // settings the update is usually already staged and one restart away.
  autoUpdater.autoDownload = true
  // Installing on quit would swap the app out from under a running export.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => publish({ kind: 'checking' }))
  autoUpdater.on('update-not-available', () => publish({ kind: 'current' }))
  autoUpdater.on('update-available', () => publish({ kind: 'downloading', percent: 0 }))
  autoUpdater.on('download-progress', (progress) => {
    publish({ kind: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publish({ kind: 'ready', version: info.version })
  })
  autoUpdater.on('error', (error: Error) => {
    publish({ kind: 'failed', message: error.message })
  })

  setTimeout(() => {
    void checkForUpdates()
  }, FIRST_CHECK_DELAY_MS)
}

/**
 * Resolves as soon as the check has been handed off — progress arrives on the
 * 'update:state' channel, not here. A rejected check is reported through the
 * same channel by the error handler above, so callers have nothing to catch.
 */
export async function checkForUpdates(): Promise<void> {
  if (!SUPPORTED) return
  // A staged update would be thrown away by a fresh check.
  if (state.kind === 'downloading' || state.kind === 'ready') return
  try {
    await autoUpdater.checkForUpdates()
  } catch (error: unknown) {
    publish({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}

/** Quits and relaunches into the new version. Only valid once 'ready'. */
export function installUpdate(): void {
  if (state.kind !== 'ready') return
  autoUpdater.quitAndInstall()
}
