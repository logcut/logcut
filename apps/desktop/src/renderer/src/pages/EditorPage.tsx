import {
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  replaceAllText,
  segmentTranscript,
  setUtteranceText
} from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { Captions, Film } from 'lucide-react'
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import MediaTab from '@/components/MediaTab'
import Panel from '@/components/Panel'
import ResizeHandle from '@/components/ResizeHandle'
import SettingsDialog from '@/components/SettingsDialog'
import SubtitleDialog from '@/components/SubtitleDialog'
import SubtitleTab from '@/components/SubtitleTab'
import Timeline from '@/components/Timeline'
import VideoPlayer from '@/components/VideoPlayer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProject } from '@/hooks/useProject'

/** The editor opens split 60/40 between the panes and the timeline. */
const TIMELINE_HEIGHT_RATIO = 0.4
const MIN_TIMELINE_HEIGHT = 96
const MIN_PANES_HEIGHT = 200
/** Mirrors --titlebar-height; the split needs it as a number. */
const TOP_BAR_HEIGHT = 36

const MIN_LEFT_WIDTH = 260
const MIN_PLAYER_WIDTH = 360
/** --space-component, mirrored here because the split maths needs the number. */
const PANE_GAP = 8

/** The two upper panes open at equal width. */
function defaultLeftWidth(): number {
  // Two outer paddings plus the handle between the panes.
  const consumed = PANE_GAP * 3
  return clamp(
    Math.round((window.innerWidth - consumed) / 2),
    MIN_LEFT_WIDTH,
    window.innerWidth - MIN_PLAYER_WIDTH
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

interface EditorPageProps {
  projectId: string
  onBack(): void
}

export default function EditorPage({ projectId, onBack }: EditorPageProps): JSX.Element {
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
  /** The line the user is pointed at: nearest, so a gap still has an answer. */
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(null)
  /** The line actually playing: strict, so silence shows no caption. */
  const [captionUtteranceId, setCaptionUtteranceId] = useState<string | null>(null)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth)
  const [timelineHeight, setTimelineHeight] = useState(() =>
    Math.max(
      MIN_TIMELINE_HEIGHT,
      Math.round((window.innerHeight - TOP_BAR_HEIGHT) * TIMELINE_HEIGHT_RATIO)
    )
  )
  const videoRef = useRef<HTMLVideoElement>(null)

  // Limits are recomputed per drag rather than cached, so a resized window
  // never leaves a stale bound behind. The ratio only seeds the initial
  // height; past that the size is whatever the user dragged it to.
  const resizeLeftPanel = (delta: number): void => {
    setLeftWidth((current) =>
      clamp(current + delta, MIN_LEFT_WIDTH, window.innerWidth - MIN_PLAYER_WIDTH)
    )
  }

  const resizeTimeline = (delta: number): void => {
    setTimelineHeight((current) =>
      clamp(
        current - delta,
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - TOP_BAR_HEIGHT - MIN_PANES_HEIGHT
      )
    )
  }

  const utterances = transcript?.utterances ?? []
  const captionText =
    utterances.find((utterance) => utterance.id === captionUtteranceId)?.text ?? null

  /**
   * The single place a time becomes "which line", called both by the player's
   * timeupdate and — while scrubbing — by the timeline, which reports the
   * pointer directly because timeupdate is far too coarse to follow a drag.
   *
   * It answers twice on purpose:
   *  - the caption burned on the video is a strict containment test, because
   *    silence between two lines genuinely means no caption;
   *  - the highlighted line is the *nearest* one, because "which subtitle am I
   *    looking at" still has an answer in a gap.
   *
   * Using the strict test for both is what made the highlight blink off in the
   * middle of a drag: the playhead followed the pointer, then the seek landed
   * in a gap and cleared everything.
   *
   * Both setters bail out on an unchanged id — timeupdate alone is ~4Hz, and
   * this subtree carries every subtitle on screen.
   */
  const applyTime = (timeMs: number): void => {
    const covering = findUtteranceIndexAt(utterances, timeMs)
    const nextCaption = covering === -1 ? null : (utterances[covering]?.id ?? null)
    setCaptionUtteranceId((current) => (current === nextCaption ? current : nextCaption))

    const nearest = findNearestUtteranceIndex(utterances, timeMs)
    const nextActive = nearest === -1 ? null : (utterances[nearest]?.id ?? null)
    setActiveUtteranceId((current) => (current === nextActive ? current : nextActive))
  }

  const seekTo = (timeMs: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = timeMs / 1000
  }

  /**
   * Seeking before opening is what puts the double-clicked line in view: the
   * highlight follows the playhead, and the list scrolls to it on its own.
   *
   * The seek lands on the line's own start rather than the clicked time, so a
   * double-click in the silence between two lines still leaves the playhead
   * inside the line the dialog opened on.
   */
  const openSubtitlesAt = (timeMs: number): void => {
    const index = findNearestUtteranceIndex(utterances, timeMs)
    const target = utterances[index]?.start ?? timeMs
    seekTo(target)
    applyTime(target)
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
    applyTime(utterance.start)
    void videoRef.current?.play()
  }

  return (
    // Panels are surfaces floating on the page background; the space between
    // them is the background showing through, and is also what resizes them.
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <EditorTopBar
        name={project?.name ?? 'Loading…'}
        onBack={onBack}
        onRename={(name) => void rename(name)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1 flex-col px-component pb-component">
        <div className="flex min-h-0 flex-1">
          {/* AI chat panel slot — deliberately empty for now. */}

          <div className="relative flex shrink-0 flex-col" style={{ width: leftWidth }}>
            <Panel className="flex min-h-0 flex-1 flex-col">
              <Tabs
                value={tab}
                onValueChange={setTab}
                className="flex min-h-0 flex-1 flex-col gap-0"
              >
                {/* An icon rail rather than two half-width pills: this is the
                    panel every future tool arrives in, so it has to stay
                    readable at a dozen entries. */}
                <TabsList>
                  <TabsTrigger value="media">
                    <Film size={18} />
                    Media
                  </TabsTrigger>
                  <TabsTrigger value="subtitle">
                    <Captions size={18} />
                    Subtitles
                  </TabsTrigger>
                </TabsList>
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
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </TabsContent>
              </Tabs>
            </Panel>

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

          <ResizeHandle orientation="vertical" onResize={resizeLeftPanel} />

          <Panel className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeAsset && !activeAsset.missing ? (
              <VideoPlayer
                ref={videoRef}
                src={activeAsset.mediaUrl}
                onTimeUpdate={applyTime}
                captionText={captionText}
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
          </Panel>
        </div>

        <ResizeHandle orientation="horizontal" onResize={resizeTimeline} />

        <Panel className="shrink-0" style={{ height: timelineHeight }}>
          <Timeline
            durationMs={activeAsset?.durationMs ?? 0}
            utterances={utterances}
            activeUtteranceId={activeUtteranceId}
            videoRef={videoRef}
            assetName={activeAsset?.fileName ?? null}
            filmstripUrl={activeAsset?.filmstripUrl ?? null}
            waveformUrl={activeAsset?.waveformUrl ?? null}
            onScrub={applyTime}
            onEditSubtitlesAt={openSubtitlesAt}
          />
        </Panel>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {error !== null && (
        <p className="m-0 shrink-0 px-inset pb-component text-caption font-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
