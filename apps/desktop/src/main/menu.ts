import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/**
 * The application menu.
 *
 * Setting one at all is what puts Settings where a desktop app keeps it, but it
 * also *replaces* Electron's default menu — and that default is where the
 * standard editing shortcuts come from. So every role menu below has to be
 * spelled out: drop the Edit menu and Cmd/Ctrl+C, V, Z and A stop working in
 * every input in the app, with nothing on screen to explain why.
 */

/**
 * Settings is a dialog owned by the renderer, so the menu can only ask for it.
 * The focused window, falling back to the first one, because on macOS the menu
 * is reachable while no window has focus.
 */
function openSettings(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:open-settings')
}

const isMac = process.platform === 'darwin'

/** Placement and accelerator both follow the platform convention — see
 *  menu.md. */
const settingsItem: MenuItemConstructorOptions = {
  label: 'Settings…',
  accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
  click: openSettings
}

function template(): MenuItemConstructorOptions[] {
  return [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              settingsItem,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: isMac ? [{ role: 'close' }] : [settingsItem, { type: 'separator' }, { role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    },
    // About is in the application menu on macOS, so Help would be an empty
    // menu there and is left out entirely.
    ...(isMac ? [] : [{ label: 'Help', submenu: [{ role: 'about' as const }] }])
  ]
}

export function registerMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()))
}
