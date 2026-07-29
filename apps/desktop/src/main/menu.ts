import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/** The application menu. **Setting one replaces Electron's default**, which is
 *  where the standard editing shortcuts come from — drop the Edit menu and
 *  Cmd/Ctrl+C, V, Z and A stop working in every input in the app, with nothing
 *  on screen to explain why. */

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

/**
 * Switches that only exist while developing.
 *
 * Gated on `app.isPackaged` rather than on NODE_ENV: what these toggle lives in
 * React's development build and is simply absent from a packaged app, so the
 * menu would be offering something that cannot happen.
 *
 * Checkboxes, so the menu itself carries the state — there is nowhere else for
 * it to show, and Electron flips `checked` before `click` runs.
 */
function developerMenu(): MenuItemConstructorOptions[] {
  if (app.isPackaged) return []
  return [
    {
      label: 'Developer',
      submenu: [
        {
          // Named for React, not just "Owner Stacks": on its own in a menu the
          // phrase gives no clue whose feature it is.
          label: 'React Owner Stacks',
          type: 'checkbox',
          // Off to begin with. They cost about half of everything the renderer
          // does in development (see lib/dev-owner-stacks.md), and what they buy
          // is wanted at a specific moment rather than continuously.
          checked: false,
          click: (item) => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
            win?.webContents.send('menu:set-owner-stacks', item.checked)
          }
        }
      ]
    }
  ]
}

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
              ...developerMenu(),
              ...(app.isPackaged ? [] : [{ type: 'separator' as const }]),
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
        { role: 'togglefullscreen' },
        // Only where there is no application menu to put it in.
        ...(isMac ? [] : developerMenu())
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
