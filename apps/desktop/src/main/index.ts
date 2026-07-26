import { app, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { handleMediaRequest, MEDIA_SCHEME } from './media'
import { flushTranscripts } from './projects'

// standard is required: without it the media stack fails with
// PIPELINE_ERROR_READ on seekable (Range) responses.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, stream: true, supportFetchAPI: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'LogCut',
    // Matches --ink-page so the window doesn't flash white before the
    // dark renderer paints.
    backgroundColor: '#101214',
    // macOS only: hide the title bar so content reaches the top edge, and hide
    // the system buttons too (below) because the renderer draws its own. The
    // AppKit ones cannot be resized or recoloured — only placed — and we want
    // 12px circles that dim to the panel colour when the window loses focus.
    //
    // Other platforms keep their native title bar and its native controls;
    // nothing here applies to them.
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Transcript writes are debounced, so the last edits before a quit are still
// only in memory at this point.
app.on('before-quit', () => {
  flushTranscripts()
})

app.on('window-all-closed', () => {
  flushTranscripts()
  if (process.platform !== 'darwin') app.quit()
})
