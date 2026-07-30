import {
  captionFontSizePct,
  captionLengthFor,
  captionShadowOffset,
  captionWrapShare,
  DEFAULT_LINE_RATIO
} from '@logcut/core'
import type { CaptionStyle } from '@logcut/core'
import type { ComponentProps, JSX, ReactNode, Ref } from 'react'

/** `#rrggbb` and a percentage, as the eight-digit hex CSS takes. */
function withAlpha(hex: string, opacityPct: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacityPct / 100)) * 255)
  return `${hex}${alpha.toString(16).padStart(2, '0')}`
}

/** How wide the text is allowed to run, in this surface's pixels. Exported
 *  because the width handles report it, and they are drawn by the caller. */
export function captionWrapPx(style: CaptionStyle, frameWidth: number): number {
  return frameWidth * captionWrapShare(style.widthPct)
}

export interface CaptionSurfaceProps {
  text: string
  style: CaptionStyle
  /** CSS font-family, already resolved against the machine's fonts. */
  fontStack: string
  /** The picture this caption is laid out against, in pixels. Every length
   *  below is derived from it, which is what makes the same style land the same
   *  way in a 400px preview and a 4K export. */
  frame: { width: number; height: number }
  /** Interaction on the positioned block — dragging. Empty when exporting. */
  blockProps?: ComponentProps<'div'>
  /** Interaction and edit-state appearance on the text itself. */
  textProps?: ComponentProps<'div'>
  textRef?: Ref<HTMLDivElement>
  /** Remounts the text element. The editor flips this to hand the node's text
   *  back to React after the browser has owned it (see VideoPlayer.md). */
  textKey?: string
  /** Drawn inside the block, so it turns and scales with it: the handles. */
  children?: ReactNode
}

/**
 * One caption, laid out on the picture.
 *
 * **This is the only place a caption's appearance is expressed**, and it is
 * mounted twice: once inside the player for the preview, once inside the
 * offscreen window the export renders from. That is the whole point — the burn
 * is not a second implementation that has to agree with this one, it is a
 * screenshot of this one (see CaptionSurface.md).
 */
export default function CaptionSurface({
  text,
  style,
  fontStack,
  frame,
  blockProps,
  textProps,
  textRef,
  textKey,
  children
}: CaptionSurfaceProps): JSX.Element {
  /** The caption's size in this surface's pixels. Every other length below is
   *  derived from it or scaled the same way, so it is computed once. */
  const fontSizePx = (frame.height * captionFontSizePct(style)) / 100
  const wrapPx = captionWrapPx(style, frame.width)
  const shadowOffset = captionShadowOffset(style, frame.height)

  /** **The caption's only style source — not one design token belongs in here**
   *  (see CaptionSurface.md). */
  const captionCss = {
    fontFamily: fontStack,
    fontSize: fontSizePx,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    color: withAlpha(style.color, style.fillOpacityPct),
    letterSpacing: captionLengthFor(style.letterSpacing, frame.height),
    lineHeight: `${fontSizePx * DEFAULT_LINE_RATIO + captionLengthFor(style.lineSpacing, frame.height)}px`,
    textAlign: style.align,
    // **Doubled, and painted under the fill.** A CSS text stroke straddles the
    // glyph's edge while a stroke that grows outward only would not, so twice
    // the width with the fill on top leaves exactly the half that was asked for.
    WebkitTextStrokeWidth: style.outline
      ? captionLengthFor(style.outlineWidth, frame.height) * 2
      : 0,
    WebkitTextStrokeColor: withAlpha(style.outlineColor, style.outlineOpacityPct),
    paintOrder: 'stroke fill',
    textShadow: style.shadow
      ? `${shadowOffset.dx}px ${shadowOffset.dy}px ${captionLengthFor(style.shadowBlur, frame.height)}px ${withAlpha(style.shadowColor, style.shadowOpacityPct)}`
      : 'none',
    backgroundColor: style.background
      ? withAlpha(style.backgroundColor, style.backgroundOpacityPct)
      : 'transparent',
    padding: style.background
      ? `${captionLengthFor(style.backgroundPadY, frame.height)}px ${captionLengthFor(style.backgroundPadX, frame.height)}px`
      : 0,
    borderRadius: captionLengthFor(style.backgroundRadius, frame.height)
  } as const

  return (
    // Positioned by its centre, then rotated about it — storing a corner
    // instead would let scaling and rotation move the caption.
    <div
      data-caption-block
      // Flex and not `text-align`, so the box takes its height from the plate
      // exactly — an inline-block adds the line box's descender.
      {...blockProps}
      className={`absolute flex justify-center ${blockProps?.className ?? ''}`}
      style={{
        left: `${style.x * 100}%`,
        top: `${style.y * 100}%`,
        transform: `translate(-50%, -50%) rotate(${style.rotation}deg)`,
        // **`max-content`, never `auto`.** An absolutely positioned box
        // shrink-to-fits against "containing block − `left`" — half the picture
        // at the default position — and the centring translate runs after
        // layout, so it hands none of that back.
        width: style.widthPct === 0 ? 'max-content' : wrapPx,
        maxWidth: wrapPx,
        ...blockProps?.style
      }}
    >
      <div
        key={textKey}
        ref={textRef}
        {...textProps}
        className={`max-w-full text-balance whitespace-pre-wrap ${textProps?.className ?? ''}`}
        style={{
          ...captionCss,
          // **The plate fills the block, so dragging the width drags the plate**
          // (see CaptionSurface.md). `border-box` is what makes the two edges
          // the same edge: the padding is drawn inside the width rather than
          // added to it, so the plate is exactly what the handles enclose.
          // On auto there is no width to fill — the block is `max-content`, and
          // the plate ends up hugging the text, which is what auto means.
          ...(style.widthPct === 0 ? {} : { width: '100%', boxSizing: 'border-box' }),
          ...textProps?.style
        }}
      >
        {text}
      </div>
      {children}
    </div>
  )
}
