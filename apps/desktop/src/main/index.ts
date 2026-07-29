import { app, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import { registerAgentBridge } from './agent-bridge'
import { registerIpc } from './ipc'
import { handleMediaRequest, MEDIA_SCHEME } from './media'
import { startMcpServer, stopMcpServer } from './mcp-server'
import { registerMenu } from './menu'
import { flushTranscripts } from './projects'
import { registerUpdater } from './updater'

// standard is required: without it the media stack fails with
// PIPELINE_ERROR_READ on seekable (Range) responses.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      stream: true,
      supportFetchAPI: true,
      // Without this Chromium refuses a cross-origin check on the scheme
      // outright — "only supported for protocol schemes: chrome, …" — and any
      // use that counts as reading the pixels fails. `mask-image` is one: a
      // mask samples the alpha channel, so unlike `background-image` it is
      // treated as a cross-origin read, and the timeline's waveforms silently
      // never loaded (see components/Timeline.md).
      corsEnabled: true
    }
  }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 850,
    // Below these the editor's panes stop being usable, so the window refuses
    // to shrink any further. The width has to hold four columns at once — the
    // tab panel, the player, the chat column, and the gaps between them.
    minWidth: 1180,
    minHeight: 650,
    title: 'LogCut',
    // Matches --ink-page so the window doesn't flash white before the
    // dark renderer paints.
    backgroundColor: '#101214',
    // macOS only: hide the title bar so content reaches the top edge, and hide
    // the system buttons because the renderer draws its own (why: see
    // components/WindowControls.tsx). Other platforms keep both.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.platform === 'darwin') {
    // The renderer draws the traffic lights; leaving the AppKit ones visible
    // would stack two sets of buttons on top of each other.
    win.setWindowButtonVisibility(false)
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
  registerIpc()
  registerAgentBridge()
  startMcpServer()
  registerMenu()
  // After createWindow so the first state broadcast has somewhere to land;
  // the check itself is delayed well past startup regardless.
  createWindow()
  registerUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Transcript writes are debounced, so the last edits before a quit are still
// only in memory at this point.
app.on('before-quit', () => {
  stopMcpServer()
  flushTranscripts()
})

app.on('window-all-closed', () => {
  flushTranscripts()
  if (process.platform !== 'darwin') app.quit()
})
