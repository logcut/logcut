import {
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  replaceAllText,
  segmentTranscript,
  setUtteranceText
} from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { Captions, Film } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import MediaTab from '@/components/MediaTab'
import Panel from '@/components/Panel'
import ResizeHandle from '@/components/ResizeHandle'
import SettingsDialog from '@/components/SettingsDialog'
import SubtitleDialog from '@/components/SubtitleDialog'
import SubtitleTab from '@/components/SubtitleTab'
import Timeline from '@/components/Timeline'
import type { TimelineClipView } from '@/components/Timeline'
import VideoPlayer from '@/components/VideoPlayer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProject } from '@/hooks/useProject'
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback'
import { layUtterances } from '@/lib/timeline'
import type { MediaAssetSummary } from '../../../shared/ipc'

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
    transcripts,
    loading,
    error,
    asr,
    importMedia,
    removeMedia,
    addClip,
    removeClip,
    rename,
    transcribe,
    applyTranscript,
    undo,
    undoableAssetId,
    exportSrt
  } = useProject(projectId)

  const [tab, setTab] = useState('media')
  /** Media-library highlight only. What is being edited is on the timeline. */
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  /** The clip the timeline has selected — what Delete removes. */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
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

  const clips = useMemo(() => project?.timeline ?? [], [project])
  const assets = useMemo(() => project?.assets ?? [], [project])
  const playback = useTimelinePlayback(videoRef, clips, assets)

  const assetOf = (assetId: string): MediaAssetSummary | null =>
    assets.find((asset) => asset.id === assetId) ?? null

  /** Clips with their asset's artwork folded in, ready to draw. */
  const clipViews = useMemo<TimelineClipView[]>(
    () =>
      clips.map((clip) => {
        const asset = assets.find((candidate) => candidate.id === clip.assetId)
        return {
          id: clip.id,
          startMs: clip.startMs,
          durationMs: clip.durationMs,
          name: asset?.fileName ?? 'Missing media',
          filmstripUrl: asset?.filmstripUrl ?? null,
          waveformUrl: asset?.waveformUrl ?? null,
          missing: asset?.missing ?? true
        }
      }),
    [clips, assets]
  )

  /**
   * Every clip's subtitles on the timeline's own clock. Downstream this reads
   * exactly like one transcript, which is what keeps the searches, the block
   * merging and the highlight unaware that the timeline is made of pieces.
   */
  const utterances = useMemo(() => layUtterances(clips, transcripts), [clips, transcripts])

  /** Subtitle work targets the selected clip, or the first one laid down. */
  const subtitleClip = clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null
  const subtitleAssetId = subtitleClip?.assetId ?? null
  const subtitleTranscript = subtitleAssetId ? (transcripts[subtitleAssetId] ?? null) : null

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

  /** The dialog speaks the transcript's own ids, the timeline speaks composite
   *  ones — the same line has two names and this is the crossing point. */
  const activeSourceId =
    utterances.find((utterance) => utterance.id === activeUtteranceId)?.sourceId ?? null

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
    playback.seek(timeMs)
    applyTime(timeMs)
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
    const line = utterances[index]
    // Opening on the clip the line came from is what makes the dialog show the
    // right transcript when several clips are laid down.
    if (line) setSelectedClipId(line.clipId)
    seekTo(line?.start ?? timeMs)
    setSubtitlesOpen(true)
  }

  const handleEditSave = (id: string, text: string): void => {
    if (!subtitleTranscript || !subtitleAssetId) return
    applyTranscript(subtitleAssetId, setUtteranceText(subtitleTranscript, id, text))
  }

  const handleResegment = (): void => {
    if (!subtitleTranscript || !subtitleAssetId) return
    applyTranscript(subtitleAssetId, segmentTranscript(subtitleTranscript))
  }

  const handleReplaceAll = (find: string, replace: string): number => {
    if (!subtitleTranscript || !subtitleAssetId) return 0
    const result = replaceAllText(subtitleTranscript, find, replace)
    if (result.count > 0) applyTranscript(subtitleAssetId, result.transcript)
    return result.count
  }

  /** The dialog speaks the transcript's own ids; the timeline speaks its own. */
  const seekToUtterance = (utterance: Utterance): void => {
    const start = subtitleClip ? subtitleClip.startMs + utterance.start : utterance.start
    seekTo(start)
    void videoRef.current?.play()
  }

  return (
    // Panels are surfaces floating on the page background; the space between
    // them is the background showing through, and is also what resizes them.
    // The 650px floor mirrors the window's minHeight (see main/index.ts).
    <div className="flex h-screen min-h-[650px] flex-col overflow-hidden bg-background">
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
                    selectedAssetId={selectedAssetId}
                    timelineAssetIds={clips.map((clip) => clip.assetId)}
                    onImport={(paths) => void importMedia(paths)}
                    onSelect={setSelectedAssetId}
                    onRemove={(assetId) => void removeMedia(assetId)}
                  />
                </TabsContent>
                <TabsContent value="subtitle" className="flex min-h-0 flex-col">
                  <SubtitleTab
                    asset={subtitleAssetId ? assetOf(subtitleAssetId) : null}
                    transcript={subtitleTranscript}
                    asr={asr}
                    onTranscribe={(config, force) => {
                      if (subtitleAssetId) void transcribe(subtitleAssetId, config, force)
                    }}
                    onExportSrt={() =>
                      subtitleAssetId ? exportSrt(subtitleAssetId) : Promise.resolve(null)
                    }
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </TabsContent>
              </Tabs>
            </Panel>

            {subtitlesOpen && (
              <SubtitleDialog
                utterances={subtitleTranscript?.utterances ?? []}
                activeId={activeSourceId}
                canUndo={undoableAssetId !== null && undoableAssetId === subtitleAssetId}
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
            {playback.src !== '' ? (
              <VideoPlayer
                ref={videoRef}
                src={playback.src}
                // The element's clock restarts on every clip; the timeline's
                // does not, so element time is translated before use.
                onTimeUpdate={(elementMs) => applyTime(playback.toTimelineMs(elementMs))}
                onEnded={playback.advance}
                captionText={captionText}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-component text-muted-foreground">
                <Film size={32} />
                <p className="m-0 text-body font-normal">
                  {loading
                    ? 'Opening project…'
                    : clips.length > 0
                      ? 'The media file is missing from disk.'
                      : assets.length > 0
                        ? 'Drag a video onto the timeline to start editing.'
                        : 'Import a video to get started.'}
                </p>
              </div>
            )}
          </Panel>
        </div>

        <ResizeHandle orientation="horizontal" onResize={resizeTimeline} />

        <Panel className="shrink-0" style={{ height: timelineHeight }}>
          <Timeline
            durationMs={playback.durationMs}
            clips={clipViews}
            utterances={utterances}
            activeUtteranceId={activeUtteranceId}
            selectedClipId={selectedClipId}
            videoRef={videoRef}
            clipOffsetMs={playback.clip?.startMs ?? 0}
            onSelectClip={setSelectedClipId}
            onRemoveClip={(clipId) => void removeClip(clipId)}
            onSeek={playback.seek}
            onScrub={applyTime}
            onDropAsset={(assetId) => void addClip(assetId)}
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
