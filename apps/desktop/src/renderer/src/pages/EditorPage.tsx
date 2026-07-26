import {
  findUtteranceIndexAt,
  replaceAllText,
  segmentTranscript,
  setUtteranceText
} from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { Film } from 'lucide-react'
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import MediaTab from '@/components/MediaTab'
import SubtitleDialog from '@/components/SubtitleDialog'
import SubtitleTab from '@/components/SubtitleTab'
import Timeline from '@/components/Timeline'
import VideoPlayer from '@/components/VideoPlayer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProject } from '@/hooks/useProject'

interface EditorPageProps {
  projectId: string
  onBack(): void
  onOpenSettings(): void
}

export default function EditorPage({
  projectId,
  onBack,
  onOpenSettings
}: EditorPageProps): JSX.Element {
  const {
    project,
    activeAsset,
    transcript,
    loading,
    error,
    asr,
    importMedia,
    removeMedia,
    setActiveMedia,
    rename,
    transcribe,
    applyTranscript,
    undo,
    canUndo,
    exportSrt
  } = useProject(projectId)

  const [tab, setTab] = useState('media')
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(null)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const utterances = transcript?.utterances ?? []
  const captionText =
    utterances.find((utterance) => utterance.id === activeUtteranceId)?.text ?? null

  const handleTimeUpdate = (timeMs: number): void => {
    const index = findUtteranceIndexAt(utterances, timeMs)
    const nextId = index === -1 ? null : (utterances[index]?.id ?? null)
    // Bail out on an unchanged id so a 4Hz timeupdate does not re-render the
    // subtitle-bearing subtree four times a second.
    setActiveUtteranceId((current) => (current === nextId ? current : nextId))
  }

  const seekTo = (timeMs: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = timeMs / 1000
  }

  /**
   * Seeking before opening is what puts the double-clicked line in view: the
   * active utterance follows the playhead, and the list scrolls to it on its
   * own.
   */
  const openSubtitlesAt = (timeMs: number): void => {
    seekTo(timeMs)
    const index = findUtteranceIndexAt(utterances, timeMs)
    if (index !== -1) setActiveUtteranceId(utterances[index]?.id ?? null)
    setSubtitlesOpen(true)
  }

  const handleEditSave = (id: string, text: string): void => {
    if (!transcript) return
    applyTranscript(setUtteranceText(transcript, id, text))
  }

  const handleResegment = (): void => {
    if (transcript) applyTranscript(segmentTranscript(transcript))
  }

  const handleReplaceAll = (find: string, replace: string): number => {
    if (!transcript) return 0
    const result = replaceAllText(transcript, find, replace)
    if (result.count > 0) applyTranscript(result.transcript)
    return result.count
  }

  const seekToUtterance = (utterance: Utterance): void => {
    seekTo(utterance.start)
    void videoRef.current?.play()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <EditorTopBar
        name={project?.name ?? 'Loading…'}
        onBack={onBack}
        onRename={(name) => void rename(name)}
        onOpenSettings={onOpenSettings}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* AI chat panel slot — deliberately empty for now. */}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <Tabs
              value={tab}
              onValueChange={setTab}
              className="flex w-96 shrink-0 flex-col gap-0 border-r border-border"
            >
              <div className="shrink-0 p-inset pb-0">
                <TabsList className="w-full">
                  <TabsTrigger value="media">Media</TabsTrigger>
                  <TabsTrigger value="subtitle">Subtitles</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="media" className="flex min-h-0 flex-col">
                <MediaTab
                  assets={project?.assets ?? []}
                  activeAssetId={project?.activeAssetId ?? null}
                  onImport={(paths) => void importMedia(paths)}
                  onSelect={(assetId) => void setActiveMedia(assetId)}
                  onRemove={(assetId) => void removeMedia(assetId)}
                />
              </TabsContent>
              <TabsContent value="subtitle" className="flex min-h-0 flex-col">
                <SubtitleTab
                  asset={activeAsset}
                  transcript={transcript}
                  asr={asr}
                  onTranscribe={(config, force) => void transcribe(config, force)}
                  onExportSrt={exportSrt}
                  onOpenSettings={onOpenSettings}
                />
              </TabsContent>
            </Tabs>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {activeAsset && !activeAsset.missing ? (
                <VideoPlayer
                  ref={videoRef}
                  src={activeAsset.mediaUrl}
                  onTimeUpdate={handleTimeUpdate}
                  captionText={captionText}
                  captionsOn={captionsOn}
                  onToggleCaptions={() => setCaptionsOn((on) => !on)}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-component text-muted-foreground">
                  <Film size={32} />
                  <p className="m-0 text-body font-normal">
                    {loading
                      ? 'Opening project…'
                      : activeAsset?.missing
                        ? 'The media file is missing from disk.'
                        : 'Import a video to get started.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Timeline
            durationMs={activeAsset?.durationMs ?? 0}
            utterances={utterances}
            activeUtteranceId={activeUtteranceId}
            videoRef={videoRef}
            assetName={activeAsset?.fileName ?? null}
            onEditSubtitlesAt={openSubtitlesAt}
          />
        </div>

        {subtitlesOpen && (
          <SubtitleDialog
            utterances={utterances}
            activeId={activeUtteranceId}
            canUndo={canUndo}
            onClose={() => setSubtitlesOpen(false)}
            onSeek={seekToUtterance}
            onEditSave={handleEditSave}
            onUndo={undo}
            onResegment={handleResegment}
            onReplaceAll={handleReplaceAll}
          />
        )}
      </div>

      {error !== null && (
        <p className="m-0 shrink-0 border-t border-border px-inset py-component text-caption font-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
