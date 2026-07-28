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
import type { Transcript, Utterance } from '@logcut/core'
import { Captions, Film } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import MediaTab from '@/components/MediaTab'
import Panel from '@/components/Panel'
import ResizeHandle from '@/components/ResizeHandle'
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
const MIN_CHAT_WIDTH = 280
const DEFAULT_CHAT_WIDTH = 340
const MIN_SUBTITLES_WIDTH = 280
const DEFAULT_SUBTITLES_WIDTH = 340
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
 * The chat column is taken out before the split rather than included in it: it
 * is a fixed number of pixels, so the row being halved is what is left of the
 * window once the column showing on open and every gap have had theirs. The
 * subtitle editor is not subtracted because it starts closed; opening it
 * re-fits the tab panel then (see `fitTabs`).
 */
function defaultTabsWidth(): number {
  // Two outer paddings plus the two handles between the three columns.
  const consumed = OUTER_GAP * 2 + PANE_GAP * 2 + DEFAULT_CHAT_WIDTH
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
  /** The dialog itself belongs to App; the subtitle tab needs to reach it. */
  onOpenSettings(): void
}

export default function EditorPage({
  projectId,
  onBack,
  onOpenSettings
}: EditorPageProps): JSX.Element {
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
    applyTranscripts,
    undo,
    canUndo,
    canRedo,
    redo,
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
  /** The left-hand column. */
  const [chatOpen, setChatOpen] = useState(true)
  /**
   * The right-hand column. Closed on open: reading and correcting subtitles is
   * something the user goes to, so clicking a line on the timeline is what
   * brings the column in. Closing it again is always deliberate — nothing takes
   * it away on its own.
   */
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [tabsWidth, setTabsWidth] = useState(defaultTabsWidth)
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH)
  const [subtitlesWidth, setSubtitlesWidth] = useState(DEFAULT_SUBTITLES_WIDTH)
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

  /** Each side column's slice of the row — nothing while it is hidden. Both are
   *  optional, so no bound below may assume either one is there. */
  const chatSlice = (): number => (chatOpen ? chatWidth : 0)
  const subtitlesSlice = (): number => (subtitlesOpen ? subtitlesWidth : 0)

  /** What is left for the flexible columns once the chat column has taken its
   *  fixed slice — the window itself while it is hidden. */
  const availableWidth = (): number => window.innerWidth - chatSlice()

  /**
   * Pull the tab panel back within bounds before a side column takes its width.
   * The player is the only pane that flexes, so it is the one that absorbs the
   * loss, and without this it is squeezed to nothing on a narrow window while
   * the tab panel keeps a width no longer available.
   *
   * The slices are passed in rather than read off state: the caller is opening
   * a column, and its own slice has to count as present before the state that
   * says so has been committed.
   */
  const fitTabs = (chat: number, subtitles: number): void => {
    setTabsWidth((current) =>
      clamp(current, MIN_TABS_WIDTH, window.innerWidth - chat - subtitles - MIN_PLAYER_WIDTH)
    )
  }

  // Limits are recomputed per drag rather than cached, so a resized window
  // never leaves a stale bound behind. The ratio only seeds the initial
  // height; past that the size is whatever the user dragged it to.
  const resizeTabs = (delta: number): void => {
    setTabsWidth((current) =>
      clamp(current + delta, MIN_TABS_WIDTH, availableWidth() - subtitlesSlice() - MIN_PLAYER_WIDTH)
    )
  }

  // The chat column is the first one, so its handle is on its right edge:
  // dragging away from the panel widens it, which is the opposite sign from a
  // handle that sits to a panel's left.
  // Each column's own bound subtracts the *other* one, never itself: the width
  // being dragged is the one under negotiation.
  const resizeChat = (delta: number): void => {
    setChatWidth((current) =>
      clamp(
        current + delta,
        MIN_CHAT_WIDTH,
        window.innerWidth - subtitlesSlice() - tabsWidth - MIN_PLAYER_WIDTH
      )
    )
  }

  // The subtitle editor is the last column, so its handle is on its left edge
  // and the sign flips: dragging left widens it.
  const resizeSubtitles = (delta: number): void => {
    setSubtitlesWidth((current) =>
      clamp(current - delta, MIN_SUBTITLES_WIDTH, availableWidth() - tabsWidth - MIN_PLAYER_WIDTH)
    )
  }

  /**
   * The one way in. Three things open this column — the title bar, clicking a
   * subtitle on the timeline, and SubtitleTab's "Edit subtitles" — and each of
   * them takes the same width out of the row, so the re-fit lives here rather
   * than at any one of the three.
   */
  const openSubtitles = (): void => {
    if (!subtitlesOpen) fitTabs(chatSlice(), subtitlesWidth)
    setSubtitlesOpen(true)
  }

  /** Closing gives the width back, so only the opening half needs the re-fit. */
  const toggleSubtitles = (): void => {
    if (subtitlesOpen) setSubtitlesOpen(false)
    else openSubtitles()
  }

  const toggleChat = (): void => {
    setChatOpen((open) => {
      if (!open) fitTabs(chatWidth, subtitlesSlice())
      return !open
    })
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
  /**
   * Show a line in the editor. **Does not seek**: the press that got here has
   * already put the playhead where it was aimed, and jumping on to the line's
   * start would overrule that. Going to a line's beginning is what clicking
   * its timecode in the list is for.
   *
   * `activeUtteranceId` is pointed at the line here rather than left to the
   * playhead: without a seek nothing else would move it, and it is what the
   * editor scrolls to. The burned caption keeps following the playhead — that
   * is `captionUtteranceId`, and the two answer different questions.
   */
  const openSubtitlesAt = (timeMs: number): void => {
    const index = findNearestUtteranceIndex(utterances, timeMs)
    const line = utterances[index]
    // Opening on the clip the line came from is what makes the editor show the
    // right transcript when several clips are laid down.
    if (line) {
      setSubtitleClipId(line.clipId)
      setActiveUtteranceId(line.id)
    }
    openSubtitles()
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
    // One history entry for the whole deletion, not one per asset: the band
    // took them in a single gesture and undo should give them back the same way.
    const changes = [...byAsset]
      .map(([assetId, sourceIds]) => ({
        assetId,
        transcript: removeUtterances(
          transcripts[assetId] ?? { audioDurationMs: 0, utterances: [] },
          sourceIds
        )
      }))
      .filter((change) => change.transcript !== transcripts[change.assetId])
    applyTranscripts(changes)
    setSelectedUtteranceIds([])
  }

  /**
   * Undo is a window-level shortcut, not a panel's: it has to work wherever
   * the user just acted, and after deleting on the timeline the focus is on
   * the timeline.
   *
   * Typing is left alone. An input, textarea or contenteditable has its own
   * undo stack for the characters being typed, and hijacking Cmd+Z there
   * would take back the previous *edit* instead of the last few keystrokes.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return
      }
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  /**
   * An edge dragged on the timeline. The timeline speaks its own clock and its
   * own ids, so both are translated back before the transcript sees them —
   * the same crossing `activeSourceId` makes in the other direction.
   */
  const handleTrimUtterances = (
    edge: 'start' | 'end',
    changes: { id: string; timeMs: number }[]
  ): void => {
    // Grouped by asset and written once each, so a drag over lines from
    // several clips is one edit and one undo step. Within a transcript the
    // changes chain, because each call returns a new one.
    const byAsset = new Map<string, Transcript>()
    for (const change of changes) {
      const line = utterances.find((utterance) => utterance.id === change.id)
      if (!line) continue
      const transcript = byAsset.get(line.assetId) ?? transcripts[line.assetId]
      if (!transcript) continue
      const clip = clips.find((candidate) => candidate.id === line.clipId)
      byAsset.set(
        line.assetId,
        setUtteranceTime(transcript, line.sourceId, edge, change.timeMs - (clip?.startMs ?? 0))
      )
    }
    applyTranscripts(
      [...byAsset]
        .filter(([assetId, transcript]) => transcript !== transcripts[assetId])
        .map(([assetId, transcript]) => ({ assetId, transcript }))
    )
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
        chatOpen={chatOpen}
        subtitlesOpen={subtitlesOpen}
        onBack={onBack}
        onRename={(name) => void rename(name)}
        onToggleChat={toggleChat}
        onToggleSubtitles={toggleSubtitles}
      />

      {/* Full-height columns: the AI chat, the picture with its timeline, and
          the subtitle editor on the far right — each side column only while it
          is showing. Neither side column is a pane in the top row — each holds
          a column of text, and that wants the window's whole height, which is
          the height the timeline gives up by not spanning the window. */}
      <div className="flex min-h-0 flex-1 px-component pb-component">
        {/* The AI chat column, holding its place until the feature is built.
            Deliberately still a placeholder rather than a component: a file of
            its own would need a spec, and there is nothing to specify until it
            holds something. The handle comes with it, so closing the column
            also takes back its gap. */}
        {chatOpen && (
          <>
            <Panel className="flex min-h-0 shrink-0 flex-col" style={{ width: chatWidth }}>
              <div className="flex min-h-0 flex-1 items-center justify-center p-inset">
                <p className="m-0 text-center text-caption font-normal text-muted-foreground">
                  AI chat — not built yet.
                </p>
              </div>
            </Panel>

            <ResizeHandle orientation="vertical" onResize={resizeChat} />
          </>
        )}

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
                      onEdit={openSubtitles}
                      onExportSrt={() =>
                        subtitleAssetId ? exportSrt(subtitleAssetId) : Promise.resolve(null)
                      }
                      onOpenSettings={onOpenSettings}
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
              onTrimUtterances={handleTrimUtterances}
              onTogglePlay={togglePlay}
              onEditSubtitlesAt={openSubtitlesAt}
            />
          </Panel>
        </div>

        {/* The subtitle editor column. Arrives by clicking a line on the
            timeline, from SubtitleTab, or from the title bar; leaves only when
            asked. The handle comes with it, so closing the column also takes
            back its gap.

            The empty state is for the title-bar route: opening the column on a
            clip that has no transcript yet has to say why it is bare, whereas
            the double-click route can only ever land on a line that exists. */}
        {subtitlesOpen && (
          <>
            <ResizeHandle orientation="vertical" onResize={resizeSubtitles} />

            <Panel className="flex min-h-0 shrink-0 flex-col" style={{ width: subtitlesWidth }}>
              {subtitleTranscript ? (
                <SubtitleEditor
                  utterances={subtitleTranscript.utterances}
                  activeId={activeSourceId}
                  canUndo={canUndo}
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
                    No subtitles yet — recognize this clip first.
                  </p>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>

      {error !== null && (
        <p className="m-0 shrink-0 px-inset pb-component text-caption font-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
