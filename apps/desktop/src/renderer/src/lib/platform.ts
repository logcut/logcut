/**
 * macOS is the only platform where the window is frameless and the renderer
 * owns the window controls; everywhere else the native title bar does.
 *
 * Read from the user agent rather than passed over IPC so it is available
 * synchronously during the first render — main.tsx sets the matching `is-mac`
 * class on <html> for the CSS side of the same question.
 */
export const isMac = navigator.userAgent.includes('Macintosh')
