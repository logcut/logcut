import { useRef } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'

interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal'
  /** Pixels moved since the last event; positive is right / down. */
  onResize(delta: number): void
}

/**
 * The gap between two panels, doubling as the handle that resizes them (see
 * ResizeHandle.md).
 *
 * **Reports a delta per event, never an absolute position**, so the caller
 * clamps however it likes without this component knowing any of the limits.
 */
export default function ResizeHandle({ orientation, onResize }: ResizeHandleProps): JSX.Element {
  const lastRef = useRef(0)
  const vertical = orientation === 'vertical'
  const positionOf = (event: ReactPointerEvent<HTMLDivElement>): number =>
    vertical ? event.clientX : event.clientY

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={`shrink-0 touch-none ${
        vertical ? 'w-compact cursor-col-resize' : 'h-compact cursor-row-resize'
      }`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        lastRef.current = positionOf(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const position = positionOf(event)
        onResize(position - lastRef.current)
        lastRef.current = position
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
    />
  )
}
