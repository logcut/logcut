import { defaultOption, languageOptionToConfig, orderedOptions } from '@logcut/core'
import type { LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'
import { Captions, Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import LanguageSelect from '@/components/LanguageSelect'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/format'
import type { AsrState } from '@/hooks/useProject'
import type { MediaAssetSummary, TranscribePhase } from '../../../shared/ipc'

function describePhase(phase: TranscribePhase): string {
  return phase === 'extracting' ? 'Extracting audio…' : 'Transcribing…'
}

interface SubtitleTabProps {
  asset: MediaAssetSummary | null
  transcript: Transcript | null
  asr: AsrState
  onTranscribe(config: TranscribeConfig, force: boolean): void
  onExportSrt(): Promise<string | null>
  onOpenSettings(): void
}

/**
 * Produces subtitles; it does not display them. The transcript itself lives on
 * the timeline, and editing happens in the dialog a subtitle block opens.
 */
export default function SubtitleTab({
  asset,
  transcript,
  asr,
  onTranscribe,
  onExportSrt,
  onOpenSettings
}: SubtitleTabProps): JSX.Element {
  const [languageOrder, setLanguageOrder] = useState<LanguageOption[]>(orderedOptions('en-US'))
  const [language, setLanguage] = useState<LanguageOption>('auto')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void (async () => {
      const locale = await window.logcut.getSystemLocale()
      const saved = await window.logcut.getLanguagePreference()
      setLanguageOrder(orderedOptions(locale))
      setLanguage(saved ?? defaultOption(locale))
    })()
  }, [])

  const chooseLanguage = (option: LanguageOption): void => {
    setLanguage(option)
    void window.logcut.setLanguagePreference(option)
  }

  const exportSrt = async (): Promise<void> => {
    setMessage('')
    try {
      const savedPath = await onExportSrt()
      if (savedPath) setMessage(`Saved to ${savedPath}`)
    } catch {
      setMessage('Export failed.')
    }
  }

  if (!asset) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-inset">
        <p className="text-center text-body font-normal text-muted-foreground">
          Import a video first, then generate its subtitles here.
        </p>
      </div>
    )
  }

  const running = asr.kind === 'running'
  const hasTranscript = transcript !== null && transcript.utterances.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto p-inset">
      <div className="flex flex-col gap-component">
        <span className="text-caption font-normal text-muted-foreground">Source language</span>
        <LanguageSelect options={languageOrder} value={language} onChange={chooseLanguage} />
      </div>

      <Button
        disabled={running || asset.missing}
        onClick={() => onTranscribe(languageOptionToConfig(language), hasTranscript)}
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <Captions size={16} />}
        {running
          ? describePhase(asr.phase)
          : hasTranscript
            ? 'Recognize again'
            : 'Generate subtitles'}
      </Button>

      {running && (
        <p className="m-0 text-caption font-normal text-muted-foreground">
          This takes a few minutes and cannot be cancelled yet.
        </p>
      )}

      {asr.kind === 'failed' && (
        <div className="flex flex-col gap-component">
          <p className="m-0 text-caption font-normal text-destructive">{asr.message}</p>
          {asr.apiKeyProblem && (
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              Open Settings
            </Button>
          )}
        </div>
      )}

      {hasTranscript && (
        <div className="flex flex-col gap-component border-t border-border pt-stack">
          <span className="text-caption font-normal text-muted-foreground">
            {transcript.utterances.length} lines ·{' '}
            <span className="timecode">{formatDuration(transcript.audioDurationMs)}</span>
          </span>
          <p className="m-0 text-caption font-normal text-muted-foreground">
            Double-click a subtitle block on the timeline to edit the text.
          </p>
          <div className="flex flex-wrap gap-component">
            <Button variant="outline" size="sm" onClick={() => void exportSrt()}>
              <Download size={14} />
              Export SRT
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={running || asset.missing}
              onClick={() => onTranscribe(languageOptionToConfig(language), true)}
            >
              <RefreshCw size={14} />
              Re-recognize
            </Button>
          </div>
        </div>
      )}

      {message !== '' && (
        <p className="m-0 text-caption font-normal text-muted-foreground">{message}</p>
      )}
    </div>
  )
}
