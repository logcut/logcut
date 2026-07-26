import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { isMac } from '@/lib/platform'

interface ControlSpec {
  key: 'close' | 'minimize' | 'zoom'
  label: string
  color: string
  glyph: JSX.Element
  action(): void
}

/**
 * Glyphs are drawn in a 12×12 box, the button's own size, and take up a little
 * over half of it — matching how much of the system button the symbol fills.
 */
const GLYPH_STROKE = 'currentColor'
const STROKE_WIDTH = '1.5'
/** The cross reads heavier than a single bar at equal width — two strokes
 *  crossing put twice the ink in the middle — so it is drawn thinner. */
const CLOSE_STROKE_WIDTH = '1.2'

const CONTROLS: ControlSpec[] = [
  {
    key: 'close',
    label: 'Close',
    color: 'var(--window-close)',
    glyph: (
      <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke={GLYPH_STROKE} strokeWidth={CLOSE_STROKE_WIDTH} />
    ),
    action: () => void window.logcut.closeWindow()
  },
  {
    key: 'minimize',
    label: 'Minimize',
    color: 'var(--window-minimize)',
    glyph: <path d="M3 6h6" stroke={GLYPH_STROKE} strokeWidth={STROKE_WIDTH} />,
    action: () => void window.logcut.minimizeWindow()
  },
  {
    key: 'zoom',
    label: 'Zoom',
    color: 'var(--window-zoom)',
    // Two filled corners with a diagonal gap between them. Drawing them as a
    // single shape sharing the diagonal — which is what the first attempt did
    // — fuses them into a plain square.
    glyph: (
      <>
        <path d="M3.3 3.3h4.2L3.3 7.5z" fill={GLYPH_STROKE} />
        <path d="M8.7 8.7H4.5L8.7 4.5z" fill={GLYPH_STROKE} />
      </>
    ),
    action: () => void window.logcut.toggleMaximizeWindow()
  }
]

/**
 * The traffic lights, drawn by us.
 *
 * AppKit's own buttons cannot be resized or recoloured — only positioned — so
 * matching a 12px circle that dims to the panel colour when the window is
 * inactive means drawing them. main/index.ts hides the system set and this
 * renders in its place; on Windows nothing renders here at all, because the
 * native title bar still owns these actions.
 *
 * Glyphs appear on hover over the whole group, which is how macOS behaves.
 */
export default function WindowControls(): JSX.Element | null {
  const [focused, setFocused] = useState(() => document.hasFocus())

  useEffect(() => {
    const onFocus = (): void => setFocused(true)
    const onBlur = (): void => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (!isMac) return null

  return (
    <div className="group flex shrink-0 items-center gap-component [-webkit-app-region:no-drag]">
      {CONTROLS.map((control) => (
        <button
          key={control.key}
          type="button"
          aria-label={control.label}
          title={control.label}
          className="size-window-control rounded-full text-black/55 transition-colors"
          style={{ background: focused ? control.color : 'var(--window-inactive)' }}
          onClick={control.action}
        >
          <svg
            viewBox="0 0 12 12"
            className="size-full opacity-0 transition-opacity group-hover:opacity-100"
            fill="none"
            strokeLinecap="round"
          >
            {control.glyph}
          </svg>
        </button>
      ))}
    </div>
  )
}
