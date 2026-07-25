import { app, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { handleMediaRequest, MEDIA_SCHEME } from './media'

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
    // macOS only: hide the title bar so the app content reaches the top edge and
    // keep the traffic lights inset. Other platforms keep their native title bar,
    // otherwise the window would lose its close/minimize controls.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
