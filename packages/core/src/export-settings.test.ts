import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_EXPORT_SETTINGS,
  deriveBitrateKbps,
  normalizeExportSettings,
  RESOLUTION_CHOICES,
  VIDEO_BITRATE_KBPS
} from './export-settings.ts'

test('the defaults follow the source everywhere a size is optional', () => {
  // Nothing here may name a resolution or a frame rate: a project that opens
  // with one baked in would keep applying it after the media changed.
  assert.equal(DEFAULT_EXPORT_SETTINGS.width, 0)
  assert.equal(DEFAULT_EXPORT_SETTINGS.height, 0)
  assert.equal(DEFAULT_EXPORT_SETTINGS.fps, 0)
  assert.equal(DEFAULT_EXPORT_SETTINGS.videoBitrateKbps, 0)
})

test('normalizeExportSettings turns anything at all into a usable value', () => {
  assert.deepEqual(normalizeExportSettings(undefined), DEFAULT_EXPORT_SETTINGS)
  assert.deepEqual(normalizeExportSettings(null), DEFAULT_EXPORT_SETTINGS)
  assert.deepEqual(normalizeExportSettings('nonsense'), DEFAULT_EXPORT_SETTINGS)
  assert.deepEqual(normalizeExportSettings({}), DEFAULT_EXPORT_SETTINGS)
})

test('normalizeExportSettings keeps a canvas whole or takes none of it', () => {
  assert.deepEqual(normalizeExportSettings({ width: 1280, height: 720 }), {
    ...DEFAULT_EXPORT_SETTINGS,
    width: 1280,
    height: 720
  })
  // Half a size is not a size: taking one axis from disk and the other from
  // the defaults would stretch the picture rather than fall back.
  const lopsided = normalizeExportSettings({ width: 1280, height: 999 })
  assert.equal(lopsided.width, 0)
  assert.equal(lopsided.height, 0)
})

test('normalizeExportSettings rejects a canvas that is not on the menu', () => {
  const odd = normalizeExportSettings({ width: 1234, height: 567 })
  assert.equal(odd.width, 0)
  assert.equal(odd.height, 0)
})

test('normalizeExportSettings whitelists the enumerated fields', () => {
  const wild = normalizeExportSettings({
    codec: 'av1',
    quality: 'insane',
    fps: 23.976,
    audioChannels: 6,
    audioSampleRate: 96_000
  })
  assert.equal(wild.codec, 'h264')
  assert.equal(wild.quality, 'medium')
  assert.equal(wild.fps, 0)
  assert.equal(wild.audioChannels, 2)
  assert.equal(wild.audioSampleRate, 48_000)
})

test('normalizeExportSettings clamps the free-typed numbers', () => {
  assert.equal(normalizeExportSettings({ videoBitrateKbps: 9_999_999 }).videoBitrateKbps, 100_000)
  assert.equal(normalizeExportSettings({ videoBitrateKbps: 1 }).videoBitrateKbps, 500)
  assert.equal(normalizeExportSettings({ audioBitrateKbps: 1 }).audioBitrateKbps, 64)
  assert.equal(normalizeExportSettings({ audioBitrateKbps: 9999 }).audioBitrateKbps, 512)
})

test('a zero video bitrate survives, because it means derive it', () => {
  assert.equal(normalizeExportSettings({ videoBitrateKbps: 0 }).videoBitrateKbps, 0)
  // Zero means nothing for the audio rate, so it clamps into range like any
  // other out-of-range number rather than reaching ffmpeg as `-b:a 0k`.
  assert.equal(normalizeExportSettings({ audioBitrateKbps: 0 }).audioBitrateKbps, 64)
})

test('NaN and Infinity are not numbers, so they fall back rather than clamp', () => {
  assert.equal(normalizeExportSettings({ videoBitrateKbps: Number.NaN }).videoBitrateKbps, 0)
  assert.equal(
    normalizeExportSettings({ audioBitrateKbps: Number.POSITIVE_INFINITY }).audioBitrateKbps,
    192
  )
})

test('normalizeExportSettings round-trips its own output', () => {
  for (const choice of RESOLUTION_CHOICES) {
    const once = normalizeExportSettings({ ...DEFAULT_EXPORT_SETTINGS, ...choice })
    assert.deepEqual(normalizeExportSettings(once), once)
  }
})

test('deriveBitrateKbps scales with the canvas', () => {
  // 1080p at medium is the anchor the other two qualities are read against.
  assert.equal(deriveBitrateKbps(1920, 1080, 'medium', 'h264'), 8294)
  // Four times the pixels, four times the bits — to within the rounding, which
  // happens once at the end rather than per axis.
  assert.equal(deriveBitrateKbps(3840, 2160, 'medium', 'h264'), 33_178)
})

test('deriveBitrateKbps spends less on HEVC for the same picture', () => {
  const h264 = deriveBitrateKbps(1920, 1080, 'medium', 'h264')
  const hevc = deriveBitrateKbps(1920, 1080, 'medium', 'hevc')
  assert.ok(hevc < h264, 'HEVC should ask for less than H.264')
  assert.ok(Math.abs(hevc - h264 * 0.6) <= 1, `${hevc} should be about 60% of ${h264}`)
})

test('deriveBitrateKbps orders the three qualities', () => {
  const at = (quality: 'high' | 'medium' | 'low'): number =>
    deriveBitrateKbps(1920, 1080, quality, 'h264')
  assert.ok(at('low') < at('medium'))
  assert.ok(at('medium') < at('high'))
})

test('deriveBitrateKbps stays inside the range a user could type', () => {
  const tiny = deriveBitrateKbps(16, 16, 'low', 'hevc')
  const huge = deriveBitrateKbps(7680, 4320, 'high', 'h264')
  assert.equal(tiny, VIDEO_BITRATE_KBPS.min)
  assert.equal(huge, VIDEO_BITRATE_KBPS.max)
})
