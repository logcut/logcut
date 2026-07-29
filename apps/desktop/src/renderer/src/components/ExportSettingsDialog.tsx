import {
  AUDIO_BITRATE_KBPS,
  AUDIO_SAMPLE_RATE_CHOICES,
  deriveBitrateKbps,
  FPS_CHOICES,
  formatTimecode,
  RESOLUTION_CHOICES,
  VIDEO_BITRATE_KBPS
} from '@logcut/core'
import type { AudioChannels, ExportCodec, ExportQuality, ExportSettings } from '@logcut/core'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const CODEC_LABELS: Record<ExportCodec, string> = { h264: 'H.264', hevc: 'H.265 (HEVC)' }
const QUALITY_LABELS: Record<ExportQuality, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

interface ExportSettingsDialogProps {
  open: boolean
  settings: ExportSettings
  /** Length of the timeline, for the summary line. */
  durationMs: number
  /** How many captions will be burned in; zero means the source is copied. */
  captionCount: number
  /** The picture the first clip would give, so "Match source" can name it. */
  sourceFrame: { width: number; height: number } | null
  /** What this build can encode. Empty means it cannot encode at all. */
  codecs: ExportCodec[]
  onOpenChange(open: boolean): void
  /** Save these settings and start the export. */
  onExport(settings: ExportSettings): void
}

/** One labelled row. The label column is fixed so every control lines up. */
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-stack">
      <span className="w-28 shrink-0 text-label font-medium text-foreground">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

/**
 * What the export will produce, before it produces it.
 *
 * Sits between the top bar's button and the native save dialog: the file name
 * is picked after this, because choosing where to put something is the last
 * decision, not the first (see ExportSettingsDialog.md).
 */
export default function ExportSettingsDialog({
  open,
  settings,
  durationMs,
  captionCount,
  sourceFrame,
  codecs,
  onOpenChange,
  onExport
}: ExportSettingsDialogProps): JSX.Element {
  // A draft, so Cancel means what it says. The stored settings are only written
  // when the export actually starts.
  const [draft, setDraft] = useState(settings)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  const patch = (fields: Partial<ExportSettings>): void => setDraft({ ...draft, ...fields })

  const frame =
    draft.width > 0 && draft.height > 0
      ? { width: draft.width, height: draft.height }
      : (sourceFrame ?? { width: 1920, height: 1080 })
  const bitrate =
    draft.videoBitrateKbps > 0
      ? draft.videoBitrateKbps
      : deriveBitrateKbps(frame.width, frame.height, draft.quality, draft.codec)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            {formatTimecode(durationMs)}
            {captionCount > 0 ? ` · ${captionCount} captions burned in` : ' · no captions to burn'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-component">
          <Row label="Resolution">
            <Select
              value={`${draft.width}x${draft.height}`}
              onValueChange={(next) => {
                const [width, height] = next.split('x').map(Number)
                patch({ width, height })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_CHOICES.map((choice) => (
                  <SelectItem
                    key={`${choice.width}x${choice.height}`}
                    value={`${choice.width}x${choice.height}`}
                  >
                    {choice.width === 0
                      ? sourceFrame
                        ? `Match source (${sourceFrame.width} × ${sourceFrame.height})`
                        : 'Match source'
                      : `${choice.width} × ${choice.height}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="Encoder">
            <Select
              value={draft.codec}
              disabled={codecs.length === 0}
              onValueChange={(next) => patch({ codec: next as ExportCodec })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codecs.map((codec) => (
                  <SelectItem key={codec} value={codec}>
                    {CODEC_LABELS[codec]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="Quality">
            <Select
              value={draft.quality}
              onValueChange={(next) =>
                // Picking a quality hands the bitrate back to the derivation;
                // otherwise a number typed once would outrank every later choice.
                patch({ quality: next as ExportQuality, videoBitrateKbps: 0 })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['high', 'medium', 'low'] as ExportQuality[]).map((quality) => (
                  <SelectItem key={quality} value={quality}>
                    {QUALITY_LABELS[quality]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </div>

        <p className="m-0 border-t border-border pt-component text-caption font-normal text-muted-foreground">
          {CODEC_LABELS[draft.codec]} · {bitrate} kbps ·{' '}
          {draft.fps === 0 ? 'source frame rate' : `${draft.fps} fps`} · SDR Rec.709
          {draft.videoOnly ? ' · no audio' : ''}
        </p>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="quiet" size="sm" className="-ml-inline">
              <ChevronDown className={advancedOpen ? 'rotate-180' : ''} />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-component pt-component">
            <Row label="Frame Rate">
              <Select
                value={String(draft.fps)}
                onValueChange={(next) => patch({ fps: Number(next) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FPS_CHOICES.map((fps) => (
                    <SelectItem key={fps} value={String(fps)}>
                      {fps === 0 ? 'Match source' : `${fps} fps`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <Row label="Bit Rate">
              <div className="flex items-center gap-component">
                <Input
                  type="number"
                  min={VIDEO_BITRATE_KBPS.min}
                  max={VIDEO_BITRATE_KBPS.max}
                  value={bitrate}
                  onChange={(event) => patch({ videoBitrateKbps: Number(event.target.value) })}
                />
                <span className="text-caption font-normal text-muted-foreground">kbps</span>
              </div>
            </Row>

            <span className="border-t border-border pt-component text-label font-medium text-muted-foreground">
              Audio
            </span>

            <Row label="Channels">
              <Select
                value={String(draft.audioChannels)}
                disabled={draft.videoOnly}
                onValueChange={(next) => patch({ audioChannels: Number(next) as AudioChannels })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Mono</SelectItem>
                  <SelectItem value="2">Stereo</SelectItem>
                </SelectContent>
              </Select>
            </Row>

            <Row label="Sample Rate">
              <Select
                value={String(draft.audioSampleRate)}
                disabled={draft.videoOnly}
                onValueChange={(next) => patch({ audioSampleRate: Number(next) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_SAMPLE_RATE_CHOICES.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {rate} Hz
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <Row label="Bit Rate">
              <div className="flex items-center gap-component">
                <Input
                  type="number"
                  min={AUDIO_BITRATE_KBPS.min}
                  max={AUDIO_BITRATE_KBPS.max}
                  disabled={draft.videoOnly}
                  value={draft.audioBitrateKbps}
                  onChange={(event) => patch({ audioBitrateKbps: Number(event.target.value) })}
                />
                <span className="text-caption font-normal text-muted-foreground">kbps</span>
              </div>
            </Row>

            <label className="flex items-center gap-component text-label font-medium text-foreground">
              <Checkbox
                checked={draft.videoOnly}
                onCheckedChange={(checked) => patch({ videoOnly: checked === true })}
              />
              Export video only
            </label>
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onExport(draft)}>Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
