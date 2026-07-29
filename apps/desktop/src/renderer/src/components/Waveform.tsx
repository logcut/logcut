import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

/** The most samples a single column will look at before it starts skipping. */
const MAX_SAMPLES_PER_COLUMN = 64

interface WaveformProps {
  /** One byte per sample, `WAVEFORM_SAMPLE_RATE` per second — the audio
   *  itself, not an envelope (see main/ffmpeg.ts). */
  peaks: Uint8Array
  /** The clip's full width at the current zoom. */
  clipWidthPx: number
  /** The visible span, measured from the clip's left edge. */
  fromPx: number
  toPx: number
}

/**
 * The audio envelope, drawn at whatever width the timeline is currently at.
 *
 * **Only the visible span is drawn.** The timeline zooms to 500×, which puts
 * the strip past half a million pixels — beyond any canvas, and pointless to
 * paint when a screen holds a thousand of them. So the canvas is the size of
 * what shows, positioned over that part of the clip, and **the cost of drawing
 * does not grow with the length of the footage**.
 *
 * This replaced a PNG behind a CSS mask. A picture has one width, and past
 * about 1.4× zoom every pixel was upscaled; numbers have no resolution.
 *
 * **Drawn in an effect, never per React frame.** Zoom and scroll both change
 * continuously, and re-rendering a component tree on each of those is the trap
 * this file's neighbours have fallen into before (see Timeline.md).
 */
export default function Waveform({
  peaks,
  clipWidthPx,
  fromPx,
  toPx
}: WaveformProps): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement>(null)
  const left = Math.max(0, Math.floor(fromPx))
  const width = Math.min(clipWidthPx, Math.ceil(toPx)) - left

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null || width <= 0) return
    const height = canvas.clientHeight
    if (height === 0) return

    // The backing store is in device pixels while everything else here is in
    // CSS pixels; without this the bars are soft on any HiDPI screen.
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const context = canvas.getContext('2d')
    if (context === null) return
    context.scale(ratio, ratio)
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--editor-waveform').trim()

    const samplesPerPx = peaks.length / clipWidthPx

    for (let x = 0; x < width; x += 1) {
      const first = Math.floor((left + x) * samplesPerPx)
      const last = Math.max(first + 1, Math.floor((left + x + 1) * samplesPerPx))
      // The loudest sample in the column. Zoomed in that is the one sample the
      // column stands for; zoomed out it is the peak of the many it covers, so
      // the envelope stays right at every width — and **no interpolation**,
      // which would smooth away exactly the swing between samples that makes
      // this read as a waveform rather than a volume curve.
      //
      // Past a sample of them the answer stops changing: fully zoomed out a
      // column can span thousands, where missing one among them is invisible
      // and walking an hour of audio on every redraw is not.
      const step = Math.max(1, Math.floor((last - first) / MAX_SAMPLES_PER_COLUMN))
      let peak = 0
      for (let at = first; at < last && at < peaks.length; at += step) {
        const value = peaks[at]
        if (value !== undefined && value > peak) peak = value
      }
      // Square root, not the raw value. Speech averages around a tenth of full
      // scale, so mapped straight into a 16px strip almost every bar is one or
      // two pixels and only the rare peak is visible at all. The root lifts
      // quiet passages into view while leaving loud ones distinguishable.
      //
      // **Applied here rather than when the file is written.** It stays a plain
      // linear measurement, so changing how it is shown never means
      // regenerating it for every asset.
      //
      // A floor of one pixel: the baseline is what says an audio track runs
      // through here at all, and gaps in it read as the waveform being broken
      // rather than as the room being quiet.
      const bar = Math.max(1, Math.sqrt(peak / 255) * height)
      context.fillRect(x, height - bar, 1, bar)
    }
  }, [peaks, clipWidthPx, left, width])

  if (width <= 0) return null
  // `h-full`, not `bottom-0`. A canvas is a replaced element: with `height`
  // left at auto it takes its *intrinsic* size — the `height` attribute — and a
  // `bottom` that disagrees is dropped as over-constrained. The effect then
  // fed itself, reading clientHeight, multiplying by the pixel ratio, writing
  // it back as the attribute, and finding a larger clientHeight next time. The
  // strip clips to 16px, bars are drawn up from the bottom, and so only the
  // loudest few reached into view — the envelope looked like scattered spikes.
  return <canvas ref={ref} className="absolute top-0 h-full" style={{ left, width }} />
}
