import {
  findNearestUtteranceIndex,
  removeUtterances,
  findUtteranceIndexAt,
  insertUtteranceAfter,
  mergeUtterances,
  nextSpeakerId,
  replaceAllText,
  segmentTranscript,
  setUtteranceSpeaker,
  setUtteranceText,
  setUtteranceTime,
  speakerIdsOf
} from '@logcut/core'
import type { Utterance } from '@logcut/core'
import { Captions, Film } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import MediaTab from '@/components/MediaTab'
import Panel from '@/components/Panel'
import ResizeHandle from '@/components/ResizeHandle'
import SettingsDialog from '@/components/SettingsDialog'
import SubtitleEditor from '@/components/SubtitleEditor'
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

const MIN_TABS_WIDTH = 260
const MIN_PLAYER_WIDTH = 360
const MIN_SIDEBAR_WIDTH = 280
const DEFAULT_SIDEBAR_WIDTH = 340
/**
 * The two gaps, mirrored from CSS because the split maths needs the numbers.
 * `--space-component` around the outside of the panels, `--space-compact`
 * between them: the cards read as one group that way, rather than as pieces
 * spaced the same distance from each other as from the window.
 */
const OUTER_GAP = 8
const PANE_GAP = 6

/**
 * The tab panel and the player open at equal width — they share the upper row,
 * and neither is the one the eye should go to first.
 *
 * The sidebar is taken out before the split rather than included in it: it is a
 * fixed number of pixels, because a list of subtitles wants about the same
 * width whatever size the screen is, so the row being halved is what is left of
 * the window once the sidebar and every gap have had theirs.
 */
function defaultTabsWidth(): number {
  // Two outer paddings plus the two handles between the three columns.
  const consumed = OUTER_GAP * 2 + PANE_GAP * 2 + DEFAULT_SIDEBAR_WIDTH
  return clamp(
    Math.round((window.innerWidth - consumed) / 2),
    MIN_TABS_WIDTH,
    window.innerWidth - consumed - MIN_PLAYER_WIDTH
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
    removeClips,
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
  /** Clips the timeline has selected — what Delete removes. A set, because a
   *  rubber band takes whatever it covers. */
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  /** Timeline utterance ids the band took — the composite ones, not source. */
  const [selectedUtteranceIds, setSelectedUtteranceIds] = useState<string[]>([])
  /**
   * Whose subtitles the editor is showing. Deliberately not selectedClipIds:
   * selection is a timeline gesture that arms Delete, while opening the editor
   * is a subtitle gesture. Sharing one state made double-clicking to edit put
   * a selection border on the clip, which reads as "this is about to be
   * deleted" when nothing of the sort is happening.
   */
  const [subtitleClipId, setSubtitleClipId] = useState<string | null>(null)
  /** The line the user is pointed at: nearest, so a gap still has an answer. */
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(null)
  /** The line actually playing: strict, so silence shows no caption. */
  const [captionUtteranceId, setCaptionUtteranceId] = useState<string | null>(null)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tabsWidth, setTabsWidth] = useState(defaultTabsWidth)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
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
          // 16:9 when the probe came back without dimensions — a wrong guess
          // only misjudges how many frames fit, never distorts one.
          aspect: asset?.width && asset.height ? asset.width / asset.height : 16 / 9,
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
  const subtitleClip = clips.find((clip) => clip.id === subtitleClipId) ?? clips[0] ?? null
  const subtitleAssetId = subtitleClip?.assetId ?? null
  const subtitleTranscript = subtitleAssetId ? (transcripts[subtitleAssetId] ?? null) : null

  // Limits are recomputed per drag rather than cached, so a resized window
  // never leaves a stale bound behind. The ratio only seeds the initial
  // height; past that the size is whatever the user dragged it to.
  const resizeTabs = (delta: number): void => {
    setTabsWidth((current) =>
      clamp(current + delta, MIN_TABS_WIDTH, window.innerWidth - sidebarWidth - MIN_PLAYER_WIDTH)
    )
  }

  // The sidebar is the first column now, so its handle is on its right edge:
  // dragging away from the panel widens it, which is the opposite sign from a
  // handle that sits to a panel's left.
  const resizeSidebar = (delta: number): void => {
    setSidebarWidth((current) =>
      clamp(current + delta, MIN_SIDEBAR_WIDTH, window.innerWidth - tabsWidth - MIN_PLAYER_WIDTH)
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

  /** Both the list and the inspector offer the same speakers. */
  // Memoized, like every other prop that reaches a subtitle row: those rows are
  // memoized components and a fresh array here would defeat all of it, silently
  // (see components/SubtitleList.tsx).
  const speakerIds = useMemo(
    () => (subtitleTranscript ? speakerIdsOf(subtitleTranscript) : []),
    [subtitleTranscript]
  )
  const newSpeakerId = useMemo(
    () => (subtitleTranscript ? nextSpeakerId(subtitleTranscript) : '1'),
    [subtitleTranscript]
  )

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
  const applyTime = useCallback(
    (timeMs: number): void => {
      const covering = findUtteranceIndexAt(utterances, timeMs)
      const nextCaption = covering === -1 ? null : (utterances[covering]?.id ?? null)
      setCaptionUtteranceId((current) => (current === nextCaption ? current : nextCaption))

      const nearest = findNearestUtteranceIndex(utterances, timeMs)
      const nextActive = nearest === -1 ? null : (utterances[nearest]?.id ?? null)
      setActiveUtteranceId((current) => (current === nextActive ? current : nextActive))
    },
    [utterances]
  )

  // Pulled out so the dependency is the function and not `playback`: the hook
  // returns a fresh object every render, and taking the whole thing would make
  // this — and through it every handler a subtitle row holds — change on each
  // render, undoing the row memoization entirely.
  const seekPlayback = playback.seek
  const seekTo = useCallback(
    (timeMs: number): void => {
      seekPlayback(timeMs)
      applyTime(timeMs)
    },
    [applyTime, seekPlayback]
  )

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
    // Opening on the clip the line came from is what makes the editor show the
    // right transcript when several clips are laid down.
    if (line) setSubtitleClipId(line.clipId)
    seekTo(line?.start ?? timeMs)
    setSubtitlesOpen(true)
  }

  const handleEditSave = useCallback(
    (id: string, text: string): void => {
      if (!subtitleTranscript || !subtitleAssetId) return
      applyTranscript(subtitleAssetId, setUtteranceText(subtitleTranscript, id, text))
    },
    [applyTranscript, subtitleAssetId, subtitleTranscript]
  )

  const handleSpeakerSave = useCallback(
    (id: string, speakerId: string): void => {
      if (!subtitleTranscript || !subtitleAssetId) return
      const next = setUtteranceSpeaker(subtitleTranscript, id, speakerId)
      if (next !== subtitleTranscript) applyTranscript(subtitleAssetId, next)
    },
    [applyTranscript, subtitleAssetId, subtitleTranscript]
  )

  const handleTimeSave = useCallback(
    (id: string, edge: 'start' | 'end', timeMs: number): void => {
      if (!subtitleTranscript || !subtitleAssetId) return
      const next = setUtteranceTime(subtitleTranscript, id, edge, timeMs)
      if (next !== subtitleTranscript) applyTranscript(subtitleAssetId, next)
    },
    [applyTranscript, subtitleAssetId, subtitleTranscript]
  )

  /**
   * Add and merge are offered only across a silence, so both core functions
   * return the transcript unchanged when there is nothing to do — comparing by
   * identity keeps a no-op out of the undo history.
   */
  const handleAdd = useCallback(
    (afterId: string): void => {
      if (!subtitleTranscript || !subtitleAssetId) return
      const next = insertUtteranceAfter(subtitleTranscript, afterId)
      if (next === subtitleTranscript) return
      applyTranscript(subtitleAssetId, next)

      // Move to where the line was just put. Without this the new line appears
      // in the list while the picture and the playhead stay wherever they were,
      // and the first thing anyone does with an empty subtitle is look at the
      // frame it belongs to.
      //
      // The new line starts exactly where the previous one ended (see
      // core/transcript.md), read off the transcript that produced it rather
      // than found again in the one just built — same value, one lookup.
      const before = subtitleTranscript.utterances.find((line) => line.id === afterId)
      if (before) seekTo((subtitleClip?.startMs ?? 0) + before.end)
    },
    [applyTranscript, seekTo, subtitleAssetId, subtitleClip, subtitleTranscript]
  )

  const handleMerge = useCallback(
    (firstId: string): void => {
      if (!subtitleTranscript || !subtitleAssetId) return
      const next = mergeUtterances(subtitleTranscript, firstId)
      if (next !== subtitleTranscript) applyTranscript(subtitleAssetId, next)
    },
    [applyTranscript, subtitleAssetId, subtitleTranscript]
  )

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

  /**
   * The editor speaks the transcript's own clock; the timeline speaks its own,
   * so a line's start has to be offset by its clip before anything can seek.
   *
   * `applyTime` runs immediately rather than waiting for the player's
   * timeupdate: that arrives ~4Hz and only once the seek has completed, which
   * is long enough for the highlight to visibly lag the click.
   */
  /**
   * The band hands back timeline ids; a transcript only knows its own. So the
   * lines are grouped by the asset they came from and each transcript is
   * rewritten once — a selection can span several clips, and two edits to the
   * same transcript in a row would each start from the pre-edit copy.
   */
  const handleRemoveUtterances = (timelineIds: string[]): void => {
    const byAsset = new Map<string, string[]>()
    for (const id of timelineIds) {
      const line = utterances.find((utterance) => utterance.id === id)
      if (!line) continue
      byAsset.set(line.assetId, [...(byAsset.get(line.assetId) ?? []), line.sourceId])
    }
    for (const [assetId, sourceIds] of byAsset) {
      const transcript = transcripts[assetId]
      if (!transcript) continue
      const next = removeUtterances(transcript, sourceIds)
      if (next !== transcript) applyTranscript(assetId, next)
    }
    setSelectedUtteranceIds([])
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video || playback.src === '') return
    if (video.paused) void video.play()
    else video.pause()
  }

  const seekToUtterance = useCallback(
    (utterance: Utterance): void => {
      const start = subtitleClip ? subtitleClip.startMs + utterance.start : utterance.start
      seekTo(start)
      applyTime(start)
    },
    [applyTime, seekTo, subtitleClip]
  )

  return (
    // Panels are surfaces floating on the page background; the space between
    // them is the background showing through, and is also what resizes them.
    // The floors mirror the window's minWidth/minHeight (see main/index.ts).
    // They matter on the web build and while the window is being resized, where
    // the renderer can briefly be smaller than the shell allows.
    <div className="flex h-screen min-h-[650px] min-w-[1180px] flex-col overflow-hidden bg-background">
      <EditorTopBar
        name={project?.name ?? 'Loading…'}
        onBack={onBack}
        onRename={(name) => void rename(name)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Three full-height columns: the picture and its timeline, then the two
          panels. Neither panel is a pane in the top row — each holds a list,
          and a list wants the window's whole height, which is the height the
          timeline gives up by not spanning the window.

          Nothing sits left of the player any more. That edge is the AI chat's
          when it arrives, which is why the tab panel moved off it. */}
      <div className="flex min-h-0 flex-1 px-component pb-component">
        <Panel className="flex min-h-0 shrink-0 flex-col" style={{ width: sidebarWidth }}>
          {subtitlesOpen && subtitleTranscript ? (
            <SubtitleEditor
              utterances={subtitleTranscript.utterances}
              activeId={activeSourceId}
              canUndo={undoableAssetId !== null && undoableAssetId === subtitleAssetId}
              onClose={() => setSubtitlesOpen(false)}
              onSeek={seekToUtterance}
              onEditSave={handleEditSave}
              onTimeSave={handleTimeSave}
              onAdd={handleAdd}
              onMerge={handleMerge}
              speakerIds={speakerIds}
              nextSpeakerId={newSpeakerId}
              onSpeakerSave={handleSpeakerSave}
              onUndo={undo}
              onResegment={handleResegment}
              onReplaceAll={handleReplaceAll}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-inset">
              <p className="m-0 text-center text-caption font-normal text-muted-foreground">
                Double-click a subtitle on the timeline to read and correct it here.
              </p>
            </div>
          )}
        </Panel>

        <ResizeHandle orientation="vertical" onResize={resizeSidebar} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="flex shrink-0 flex-col" style={{ width: tabsWidth }}>
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
                      onImport={(paths) => void importMedia(paths)}
                      onSelect={setSelectedAssetId}
                      onRemove={(assetId) => void removeMedia(assetId)}
                    />
                  </TabsContent>
                  {/* Producing subtitles only. Reading and correcting them is a
                    column of its own on the right — the two need very
                    different amounts of room. */}
                  <TabsContent value="subtitle" className="flex min-h-0 flex-col">
                    <SubtitleTab
                      asset={subtitleAssetId ? assetOf(subtitleAssetId) : null}
                      transcript={subtitleTranscript}
                      asr={asr}
                      onTranscribe={(config, force) => {
                        if (subtitleAssetId) void transcribe(subtitleAssetId, config, force)
                      }}
                      onEdit={() => setSubtitlesOpen(true)}
                      onExportSrt={() =>
                        subtitleAssetId ? exportSrt(subtitleAssetId) : Promise.resolve(null)
                      }
                      onOpenSettings={() => setSettingsOpen(true)}
                    />
                  </TabsContent>
                </Tabs>
              </Panel>
            </div>

            <ResizeHandle orientation="vertical" onResize={resizeTabs} />

            <Panel className="flex min-h-0 min-w-0 flex-1 flex-col">
              {playback.src !== '' ? (
                <VideoPlayer
                  videoRef={videoRef}
                  src={playback.src}
                  clipOffsetMs={playback.clip?.startMs ?? 0}
                  durationMs={playback.durationMs}
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
              selectedClipIds={selectedClipIds}
              selectedUtteranceIds={selectedUtteranceIds}
              videoRef={videoRef}
              clipOffsetMs={playback.clip?.startMs ?? 0}
              hasPlayer={playback.src !== ''}
              onSelectClips={setSelectedClipIds}
              onSelectUtterances={setSelectedUtteranceIds}
              onRemoveUtterances={handleRemoveUtterances}
              onRemoveClips={(clipIds) => void removeClips(clipIds)}
              onSeek={playback.seek}
              onScrub={applyTime}
              onDropAsset={(assetId) => void addClip(assetId)}
              onTogglePlay={togglePlay}
              onEditSubtitlesAt={openSubtitlesAt}
            />
          </Panel>
        </div>
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
