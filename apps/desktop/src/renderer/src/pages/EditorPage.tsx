import {
  DEFAULT_CAPTION_STYLES,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_MAX_CHARS,
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  nextSpeakerId,
  resolveCaptionStyle,
  speakerIdsOf
} from '@logcut/core'
import type { CaptionStyle, CommandResult, Utterance } from '@logcut/core'
import { Captions, Film } from 'lucide-react'
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import EditorTopBar from '@/components/EditorTopBar'
import ExportDialog from '@/components/ExportDialog'
import ExportSettingsDialog from '@/components/ExportSettingsDialog'
import MediaTab from '@/components/MediaTab'
import Panel from '@/components/Panel'
import ResizeHandle from '@/components/ResizeHandle'
import SubtitleEditor from '@/components/SubtitleEditor'
import SubtitleTab from '@/components/SubtitleTab'
import Timeline from '@/components/Timeline'
import TimelineToolbar from '@/components/TimelineToolbar'
import type { TimelineClipView } from '@/components/Timeline'
import VideoPlayer from '@/components/VideoPlayer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAgentBridge } from '@/hooks/useAgentBridge'
import { useExport } from '@/hooks/useExport'
import { useProject } from '@/hooks/useProject'
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback'
import { useCaptionFonts } from '@/hooks/useCaptionFonts'
import { captionFontStack as captionFontStackFor } from '@/lib/caption-fonts'
import { liveScope, styleForScope, type CaptionScope } from '@/lib/caption-scope'
import { layUtterances } from '@/lib/timeline'
import type { EditorLayout, MediaAssetSummary } from '../../../shared/ipc'

/** The editor opens split 60/40 between the panes and the timeline, with the
 *  tab panel and the player equal. */
const DEFAULT_TIMELINE_RATIO = 0.4
const DEFAULT_TABS_RATIO = 0.5
const MIN_TIMELINE_HEIGHT = 96
const MIN_PANES_HEIGHT = 200

const MIN_TABS_WIDTH = 260
const MIN_PLAYER_WIDTH = 360
const MIN_CHAT_WIDTH = 280
const DEFAULT_CHAT_WIDTH = 340
const MIN_SUBTITLES_WIDTH = 280
const DEFAULT_SUBTITLES_WIDTH = 340
/** Mirrors `--space-compact`, the handle's own width: it sits between the two
 *  shares and takes no part in the split. */
const PANE_GAP = 6

/** What "Reset layout" restores, and what the editor opens on the very first
 *  time. One source, so the two can never drift apart. */
function defaultLayout(): EditorLayout {
  return {
    chatWidth: DEFAULT_CHAT_WIDTH,
    subtitlesWidth: DEFAULT_SUBTITLES_WIDTH,
    tabsRatio: DEFAULT_TABS_RATIO,
    timelineRatio: DEFAULT_TIMELINE_RATIO,
    chatOpen: true,
    subtitlesOpen: false
  }
}

/** Anything that is not a fraction came from a layout that stored pixels, and
 *  the default stands in for it — see EditorLayout in shared/ipc.ts. */
function ratioOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
}

/** How long the arrangement has to sit still before it is written. A drag
 *  changes it on every frame; without this each one would be a disk write. */
const LAYOUT_SAVE_DELAY_MS = 500

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
    setMaxChars,
    setCaptionStyles,
    dispatch,
    doc,
    undo,
    canUndo,
    canRedo,
    redo,
    exportSrt,
    setExportSettings
  } = useProject(projectId)

  const [tab, setTab] = useState('media')
  /** Media-library highlight only. What is being edited is on the timeline. */
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
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
  /**
   * Where the playhead is, on the timeline's clock.
   *
   * A ref, not state. It changes on every frame of a drag, so as state it
   * forced a re-render of this page every frame — defeating the bail-outs on
   * the two ids below, which exist precisely so that moving *within* one line
   * costs nothing. One per-frame state is enough to cancel every bail-out on
   * the same tree.
   *
   * Nothing renders it. Its only reader is the split action, which runs on a
   * click or a keystroke and reads the current value then.
   */
  const playheadRef = useRef(0)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  /** The right-hand column, closed on open. Nothing but the user ever closes
   *  it again — see EditorPage.md. */
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  /** Which subtitles the style panel writes to. Held raw; `liveScope` is what
   *  the rest of the page reads, so a scope that vanishes cannot be used. */
  const [storedScope, setCaptionScope] = useState<CaptionScope>({ kind: 'all' })
  /** Fractions of what they divide, never pixels — see `EditorLayout`. */
  const [tabsRatio, setTabsRatio] = useState(DEFAULT_TABS_RATIO)
  const [timelineRatio, setTimelineRatio] = useState(DEFAULT_TIMELINE_RATIO)
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH)
  const [subtitlesWidth, setSubtitlesWidth] = useState(DEFAULT_SUBTITLES_WIDTH)
  /** False until the saved arrangement has been read, so the defaults on screen
   *  in the meantime are never written over it. */
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const captionFonts = useCaptionFonts()

  const clips = useMemo(() => project?.timeline ?? [], [project])
  const assets = useMemo(() => project?.assets ?? [], [project])
  const playback = useTimelinePlayback(videoRef, clips, assets)
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false)

  const {
    state: exportState,
    codecs: exportCodecs,
    start: startExport,
    cancel: cancelExport,
    dismiss: dismissExport
  } = useExport(projectId)

  const assetOf = (assetId: string): MediaAssetSummary | null =>
    assets.find((asset) => asset.id === assetId) ?? null

  /**
   * Each asset's audio envelope, fetched once and kept.
   *
   * Not carried on the asset summary: it is two orders of magnitude larger than
   * everything else there, and that shape is re-sent on every project update.
   * The envelope never changes once built, so one fetch per asset is all there
   * ever is.
   */
  const [peaks, setPeaks] = useState<Record<string, Uint8Array>>({})
  const peaksAsked = useRef(new Set<string>())

  useEffect(() => {
    for (const asset of assets) {
      // Artwork lands minutes after an import, so `hasWaveform` flips from
      // false to true and this runs again — which is why the guard is on
      // having asked, not on the flag.
      if (!asset.hasWaveform || peaksAsked.current.has(asset.id)) continue
      peaksAsked.current.add(asset.id)
      void window.logcut.getWaveform(projectId, asset.id).then((data) => {
        // Null means it went missing between the summary and the read; let a
        // later pass ask again rather than leaving the clip blank for good.
        if (data === null) {
          peaksAsked.current.delete(asset.id)
          return
        }
        setPeaks((current) => ({ ...current, [asset.id]: data }))
      })
    }
  }, [assets, projectId])

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
          peaks: (asset && peaks[asset.id]) ?? null,
          // 16:9 when the probe came back without dimensions — a wrong guess
          // only misjudges how many frames fit, never distorts one.
          aspect: asset?.width && asset.height ? asset.width / asset.height : 16 / 9,
          missing: asset?.missing ?? true
        }
      }),
    [clips, assets, peaks]
  )

  /** Every clip's subtitles on the timeline's own clock, and downstream this
   *  must keep reading as one transcript — nothing below knows about pieces. */
  const utterances = useMemo(() => layUtterances(clips, transcripts), [clips, transcripts])

  const timelineDurationMs = clips.reduce((total, clip) => total + clip.durationMs, 0)

  /**
   * Export is unavailable for two reasons and says which.
   *
   * The encoder check only bites when there is something to burn: a timeline
   * with no captions is copied through rather than rendered, which a build with
   * no encoder can still do (see main/export.md).
   */
  const exportBlockedReason =
    clips.length === 0
      ? 'Add a clip to the timeline first'
      : utterances.length > 0 && exportCodecs?.length === 0
        ? 'This build has no video encoder, so captions cannot be burned in'
        : null

  /** What "Match source" resolves to, so the dialog can name it rather than
   *  leaving the user to guess what they are matching. */
  const firstAsset = clips[0] ? assetOf(clips[0].assetId) : null
  const sourceFrame =
    firstAsset?.width !== undefined && firstAsset.height !== undefined
      ? { width: firstAsset.width, height: firstAsset.height }
      : null

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

  /** The two rows a ratio divides. Pixels are needed only while the pointer is
   *  moving, so they are measured then rather than tracked — which is exactly
   *  what keeps a window resize from touching either split. */
  const topRowRef = useRef<HTMLDivElement>(null)
  const midColumnRef = useRef<HTMLDivElement>(null)

  /**
   * Both bounds are stated as fractions of the room there is *right now*.
   *
   * A ratio has no opinion about pixels and the minimum sizes have nothing
   * else, so the two only meet against a measurement — and the measurement is
   * taken per drag, never cached, or a resized window leaves a stale bound
   * behind. What the ratio may not do is drift while the pointer is held past
   * the end: the panel stops at its minimum but the number would carry on, and
   * the next widening would pay it all back at once.
   */
  const resizeTabs = (delta: number): void => {
    const room = (topRowRef.current?.clientWidth ?? 0) - PANE_GAP
    if (room <= 0) return
    setTabsRatio((current) =>
      clamp(current + delta / room, MIN_TABS_WIDTH / room, 1 - MIN_PLAYER_WIDTH / room)
    )
  }

  // The chat column is the first one, so its handle is on its right edge:
  // dragging away from the panel widens it, which is the opposite sign from a
  // handle that sits to a panel's left.
  // Each column's own bound subtracts the *other* one, never itself: the width
  // being dragged is the one under negotiation.
  // What the flexible pair is subtracted at is their *minimum*, not the width
  // they happen to be drawn at: they give way in proportion as this column
  // grows, so anything above the minimum is still theirs to hand over.
  const resizeChat = (delta: number): void => {
    setChatWidth((current) =>
      clamp(
        current + delta,
        MIN_CHAT_WIDTH,
        window.innerWidth - subtitlesSlice() - MIN_TABS_WIDTH - MIN_PLAYER_WIDTH
      )
    )
  }

  // The subtitle editor is the last column, so its handle is on its left edge
  // and the sign flips: dragging left widens it.
  const resizeSubtitles = (delta: number): void => {
    setSubtitlesWidth((current) =>
      clamp(
        current - delta,
        MIN_SUBTITLES_WIDTH,
        availableWidth() - MIN_TABS_WIDTH - MIN_PLAYER_WIDTH
      )
    )
  }

  /** The one way in — three callers name this rather than the setter, so the
   *  entry point stays one thing to find. */
  const openSubtitles = (): void => setSubtitlesOpen(true)

  const toggleSubtitles = (): void => setSubtitlesOpen((open) => !open)

  const toggleChat = (): void => setChatOpen((open) => !open)

  /**
   * Put an arrangement on screen.
   *
   * The two side widths are clamped **here**, unlike the two ratios: a pixel
   * width came off disk and may have been saved on a different display, and
   * these two are what the other columns are measured against — a chat column
   * wider than the window leaves the panel and the player nothing to divide.
   * Each cap is what is left once every other column has its minimum. The
   * subtitle column's minimum is subtracted from the chat cap whether or not it
   * is open, because it can be opened a moment later and the arithmetic must
   * already hold.
   *
   * The ratios need none of that — a fraction means the same thing on every
   * display, which is half of why they are stored as fractions. They are only
   * checked for *being* fractions, because a layout saved before this file
   * stored ratios has pixels in those fields.
   */
  const applyLayout = useCallback((layout: EditorLayout): void => {
    setChatWidth(
      clamp(
        layout.chatWidth,
        MIN_CHAT_WIDTH,
        window.innerWidth - MIN_TABS_WIDTH - MIN_PLAYER_WIDTH - MIN_SUBTITLES_WIDTH
      )
    )
    setSubtitlesWidth(
      clamp(
        layout.subtitlesWidth,
        MIN_SUBTITLES_WIDTH,
        window.innerWidth - MIN_CHAT_WIDTH - MIN_TABS_WIDTH - MIN_PLAYER_WIDTH
      )
    )
    setTabsRatio(ratioOrDefault(layout.tabsRatio, DEFAULT_TABS_RATIO))
    setTimelineRatio(ratioOrDefault(layout.timelineRatio, DEFAULT_TIMELINE_RATIO))
    setChatOpen(layout.chatOpen)
    setSubtitlesOpen(layout.subtitlesOpen)
  }, [])

  /** Read once on entry. Nothing is written until this has finished — see
   *  `layoutLoaded`. */
  useEffect(() => {
    let cancelled = false
    void window.logcut.getEditorLayout().then((saved) => {
      if (cancelled) return
      if (saved) applyLayout(saved)
      setLayoutLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [applyLayout])

  /**
   * Write it back, once it has stopped moving.
   *
   * The debounce is what makes this affordable: every one of these values
   * changes on every frame of a drag, and the timer restarts each time, so a
   * drag costs one write at the end rather than sixty a second.
   */
  useEffect(() => {
    if (!layoutLoaded) return undefined
    const id = setTimeout(() => {
      void window.logcut.saveEditorLayout({
        chatWidth,
        subtitlesWidth,
        tabsRatio,
        timelineRatio,
        chatOpen,
        subtitlesOpen
      })
    }, LAYOUT_SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [layoutLoaded, chatWidth, subtitlesWidth, tabsRatio, timelineRatio, chatOpen, subtitlesOpen])

  /** Written straight through rather than left to the debounce above: a reset
   *  the user immediately follows by quitting still has to survive. */
  const resetLayout = (): void => {
    const fresh = defaultLayout()
    applyLayout(fresh)
    void window.logcut.saveEditorLayout(fresh)
  }

  // The handle sits above the timeline, so dragging down takes height from it.
  const resizeTimeline = (delta: number): void => {
    const room = (midColumnRef.current?.clientHeight ?? 0) - PANE_GAP
    if (room <= 0) return
    setTimelineRatio((current) =>
      clamp(current - delta / room, MIN_TIMELINE_HEIGHT / room, 1 - MIN_PANES_HEIGHT / room)
    )
  }

  /** The dialog speaks the transcript's own ids, the timeline speaks composite
   *  ones — the same line has two names and this is the crossing point. */
  const activeSourceId =
    utterances.find((utterance) => utterance.id === activeUtteranceId)?.sourceId ?? null

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

  const captionStyles = project?.captionStyles ?? DEFAULT_CAPTION_STYLES

  /** Resolved for **the line being shown**, not for the project alone —
   *  resolving only the base would hide every per-speaker and per-line
   *  override on the one surface they exist to be seen on. */
  const captionLine = utterances.find((utterance) => utterance.id === captionUtteranceId) ?? null
  const captionStyle = resolveCaptionStyle(
    captionStyles,
    captionLine ? { speakerId: captionLine.speakerId, style: captionLine.style } : undefined
  )

  /**
   * The line the style panel calls "this line": the one being pointed at,
   * which is also the one the picture is showing while playback is stopped.
   */
  const selectedLine = utterances.find((utterance) => utterance.id === activeUtteranceId) ?? null

  /** A scope can stop existing while selected (the line is deselected, a
   *  speaker's last line is reassigned). Resolved every render rather than
   *  watched for, so no edit can land somewhere invisible. */
  const captionScope = liveScope(storedScope, speakerIds, selectedLine !== null)

  /**
   * The selected line, but only when the panel is actually scoped to it.
   *
   * `selectedLine` follows the playhead and so changes every frame of a drag.
   * At any other scope it is not read at all, so pinning it to null there is
   * what keeps the memos below — and the whole style panel — still.
   */
  const scopeLine = captionScope.kind === 'line' ? selectedLine : null

  const scopedStyle = useMemo(
    () => styleForScope(captionStyles, captionScope, scopeLine),
    [captionStyles, captionScope, scopeLine]
  )

  /**
   * Where a style edit goes. The two project-level scopes are one write to the
   * project file; a line's own styling lives on the utterance, so it travels as
   * a command like every other edit to a transcript — and joins the undo
   * history, which project settings deliberately do not.
   */
  const applyStylePatch = useCallback(
    (
      patch: Partial<CaptionStyle>,
      // Set while a control is being dragged. The panel's sliders still write
      // on every frame, so only the first of them is a step worth going back
      // to. The picture's own gestures do not need this: they commit once, on
      // release (see components/VideoPlayer.tsx).
      options: { continuing?: boolean } = {}
    ): void => {
      const record = !options.continuing
      if (captionScope.kind === 'line') {
        if (!scopeLine) return
        dispatch(
          [
            {
              kind: 'subtitle.setStyle',
              assetId: scopeLine.assetId,
              id: scopeLine.sourceId,
              style: patch
            }
          ],
          { record }
        )
        return
      }
      if (captionScope.kind === 'speaker') {
        const { speakerId } = captionScope
        void setCaptionStyles(
          {
            ...captionStyles,
            bySpeaker: {
              ...captionStyles.bySpeaker,
              [speakerId]: { ...captionStyles.bySpeaker[speakerId], ...patch }
            }
          },
          { record }
        )
        return
      }
      void setCaptionStyles(
        { ...captionStyles, base: { ...captionStyles.base, ...patch } },
        { record }
      )
    },
    [captionScope, captionStyles, dispatch, scopeLine, setCaptionStyles]
  )
  const captionFontStack = captionFontStackFor(captionStyle.fontFamily, captionFonts)

  const captionText =
    utterances.find((utterance) => utterance.id === captionUtteranceId)?.text ?? null

  /**
   * Cut the line under the playhead in two.
   *
   * Declining here — rather than in a disabled button — is what lets the
   * toolbar and the shortcut share one implementation (see TimelineToolbar.md).
   * The subtraction puts the time on the transcript's own clock, which is not
   * the timeline's.
   */
  const handleSplit = useCallback((): void => {
    const timeMs = playheadRef.current
    const index = findUtteranceIndexAt(utterances, timeMs)
    const line = index === -1 ? null : utterances[index]
    if (!line) return
    // The cut acts on what is selected, and the playhead only says where. One
    // test covers both ways of having nothing to act on: nothing selected at
    // all, and a selection the playhead is not inside.
    if (!selectedUtteranceIds.includes(line.id)) return
    const clip = clips.find((candidate) => candidate.id === line.clipId)
    dispatch([
      {
        kind: 'subtitle.split',
        assetId: line.assetId,
        id: line.sourceId,
        timeMs: timeMs - (clip?.startMs ?? 0)
      }
    ])
  }, [clips, dispatch, selectedUtteranceIds, utterances])

  const toggleSnap = useCallback((): void => setSnapEnabled((on) => !on), [])

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
      playheadRef.current = timeMs
      const covering = findUtteranceIndexAt(utterances, timeMs)
      const nextCaption = covering === -1 ? null : (utterances[covering]?.id ?? null)
      setCaptionUtteranceId((current) => (current === nextCaption ? current : nextCaption))

      const nearest = findNearestUtteranceIndex(utterances, timeMs)
      const nextActive = nearest === -1 ? null : (utterances[nearest]?.id ?? null)
      setActiveUtteranceId((current) => (current === nextActive ? current : nextActive))
    },
    [utterances]
  )

  /**
   * Re-resolve both ids whenever the lines change, not only when the time does.
   *
   * They are ids, and **an id does not survive an edit of the line it names**.
   * Splitting replaces one line with two new ones, deleting takes one away,
   * merging consumes the second — after any of those the id held here points at
   * nothing, `find` returns null, and the caption vanishes from the picture
   * while the playhead has not moved at all. It came back on the next
   * `timeupdate`, which is what made it look like a flicker rather than a bug.
   *
   * `applyTime` is a pure re-resolution and its identity already tracks
   * `utterances`, so running it again on the same instant is exactly the
   * question that needs re-asking. Edits that leave ids alone — text, style,
   * speaker — still land on the bail-outs above and cost no render.
   */
  useEffect(() => {
    applyTime(playheadRef.current)
  }, [applyTime])

  /**
   * The scrubbing path into `applyTime`, collapsed to one call per frame — a
   * pointer outruns the screen, and React batches within an event but never
   * across two (see EditorPage.md).
   *
   * **The scrub path only.** `timeupdate` is ~4Hz and needs no help, and the
   * callers that seek and then immediately re-derive the highlight (see
   * `openSubtitlesAt`) need it to happen now, not next frame.
   */
  const scrubFrameRef = useRef(0)
  const scrubTimeRef = useRef(0)
  const scrubTime = useCallback(
    (timeMs: number): void => {
      scrubTimeRef.current = timeMs
      if (scrubFrameRef.current !== 0) return
      scrubFrameRef.current = requestAnimationFrame(() => {
        scrubFrameRef.current = 0
        applyTime(scrubTimeRef.current)
      })
    },
    [applyTime]
  )

  // A drag can end with the window closing under it; a pending frame would then
  // run against an unmounted tree.
  useEffect(() => () => cancelAnimationFrame(scrubFrameRef.current), [])

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

  /**
   * Put the last line a batch touched in view.
   *
   * Offered, never applied on its own: whether an edit moves the playhead
   * depends on who asked for it, so each caller decides (see EditorPage.md).
   *
   * The core reports on the transcript's own clock, so the clip's offset goes
   * back on here.
   */
  const followFocus = useCallback(
    (result: CommandResult): void => {
      const focus = [...result.outcomes].reverse().find((outcome) => outcome.focus)?.focus
      if (!focus) return
      const clip = clips.find((candidate) => candidate.assetId === focus.assetId)
      seekTo((clip?.startMs ?? 0) + focus.timeMs)
    },
    [clips, seekTo]
  )

  const handleEditSave = useCallback(
    (id: string, text: string): void => {
      if (!subtitleAssetId) return
      dispatch([{ kind: 'subtitle.setText', assetId: subtitleAssetId, id, text }])
    },
    [dispatch, subtitleAssetId]
  )

  /**
   * An edit typed on the picture. The player knows what the caption says; only
   * this page knows which line that is — and it is a *timeline* line, so both
   * its asset and the transcript's own id for it have to be recovered before a
   * command can name it (the same crossing `activeSourceId` makes).
   */
  const handleCaptionEdit = useCallback(
    (text: string): void => {
      const line = utterances.find((utterance) => utterance.id === captionUtteranceId)
      if (!line) return
      dispatch([{ kind: 'subtitle.setText', assetId: line.assetId, id: line.sourceId, text }])
    },
    [captionUtteranceId, dispatch, utterances]
  )

  const handleSpeakerSave = useCallback(
    (id: string, speakerId: string): void => {
      if (!subtitleAssetId) return
      dispatch([{ kind: 'subtitle.setSpeaker', assetId: subtitleAssetId, id, speakerId }])
    },
    [dispatch, subtitleAssetId]
  )

  const handleTimeSave = useCallback(
    (id: string, edge: 'start' | 'end', timeMs: number): void => {
      if (!subtitleAssetId) return
      dispatch([{ kind: 'subtitle.setTime', assetId: subtitleAssetId, id, edge, timeMs }])
    },
    [dispatch, subtitleAssetId]
  )

  /** The one user edit that follows its own focus: a new line is empty, and
   *  what goes in it is decided by looking at the frame. */
  const handleAdd = useCallback(
    (afterId: string): void => {
      if (!subtitleAssetId) return
      followFocus(dispatch([{ kind: 'subtitle.insertAfter', assetId: subtitleAssetId, afterId }]))
    },
    [dispatch, followFocus, subtitleAssetId]
  )

  const handleMerge = useCallback(
    (firstId: string): void => {
      if (!subtitleAssetId) return
      // No follow: merging produces nothing new to look at, and staying put
      // interrupts less.
      dispatch([{ kind: 'subtitle.merge', assetId: subtitleAssetId, firstId }])
    },
    [dispatch, subtitleAssetId]
  )

  const handleReplaceAll = (find: string, replace: string): number => {
    if (!subtitleAssetId) return 0
    const outcome = dispatch([
      { kind: 'subtitle.replaceAll', assetId: subtitleAssetId, find, replace }
    ]).outcomes[0]
    return outcome?.kind === 'subtitle.replaceAll' ? outcome.count : 0
  }

  /** An agent edits through the same funnel a click does, and **does** follow
   *  the focus — that is the only difference between the two entry points. */
  useAgentBridge({
    session: () => ({
      project: project ? { id: project.id, name: project.name } : null,
      clips: clips.map((clip) => {
        const asset = assets.find((candidate) => candidate.id === clip.assetId)
        return {
          clipId: clip.id,
          assetId: clip.assetId,
          fileName: asset?.fileName ?? 'Missing media',
          startMs: clip.startMs,
          durationMs: clip.durationMs,
          transcriptStatus: asset?.transcriptStatus ?? 'none'
        }
      })
    }),
    doc,
    dispatch: (commands) => {
      const result = dispatch(commands)
      followFocus(result)
      return result
    }
  })

  /**
   * The band hands back timeline ids; a transcript only knows its own. So the
   * lines are grouped by the asset they came from, one command each.
   *
   * The whole deletion is one batch and therefore one history entry: the band
   * took them in a single gesture and undo should give them back the same way.
   */
  const handleRemoveUtterances = (timelineIds: string[]): void => {
    const byAsset = new Map<string, string[]>()
    for (const id of timelineIds) {
      const line = utterances.find((utterance) => utterance.id === id)
      if (!line) continue
      byAsset.set(line.assetId, [...(byAsset.get(line.assetId) ?? []), line.sourceId])
    }
    dispatch(
      [...byAsset].map(([assetId, ids]) => ({ kind: 'subtitle.remove' as const, assetId, ids }))
    )
    setSelectedUtteranceIds([])
  }

  /**
   * Every window-level shortcut, in one listener so a new key cannot quietly
   * shadow an existing one (see EditorPage.md).
   *
   * The typing guard covers all of them. For a bare letter it is the whole
   * premise — `n` in a subtitle is the letter n. For Cmd+Z it is subtler: an
   * input has its own undo stack for the characters just typed, and taking
   * that over would undo the previous *edit* instead.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      // Either modifier: nothing here means Cmd+Ctrl, so accepting both costs
      // no ambiguity and keeps a foreign keyboard working.
      const accel = event.metaKey || event.ctrlKey

      if (accel && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      // Split declines on its own when the playhead is not inside a line, the
      // same way the toolbar button does — see TimelineToolbar.
      if (accel && key === 'b') {
        event.preventDefault()
        handleSplit()
        return
      }
      // A bare letter, so it must not fire as part of some other combination:
      // Cmd+N and Ctrl+N belong to the window, and Alt+N starts a dead key on
      // several layouts.
      if (key === 'n' && !accel && !event.altKey) {
        event.preventDefault()
        toggleSnap()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, handleSplit, toggleSnap])

  /**
   * An edge dragged on the timeline. The timeline speaks its own clock and its
   * own ids, so both are translated back before the transcript sees them —
   * the same crossing `activeSourceId` makes in the other direction.
   */
  const handleTrimUtterances = (
    edge: 'start' | 'end',
    changes: { id: string; timeMs: number }[]
  ): void => {
    // One command per line, all in one batch: a drag over lines from several
    // clips is one gesture and one undo step. Two edits to the same transcript
    // chain inside the batch rather than each starting from the pre-edit copy.
    dispatch(
      changes.flatMap((change) => {
        const line = utterances.find((utterance) => utterance.id === change.id)
        if (!line) return []
        const clip = clips.find((candidate) => candidate.id === line.clipId)
        return [
          {
            kind: 'subtitle.setTime' as const,
            assetId: line.assetId,
            id: line.sourceId,
            edge,
            timeMs: change.timeMs - (clip?.startMs ?? 0)
          }
        ]
      })
    )
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video || playback.src === '') return
    if (video.paused) void video.play()
    else video.pause()
  }

  /**
   * The editor speaks the transcript's own clock; the timeline speaks its own,
   * so a line's start has to be offset by its clip before anything can seek.
   *
   * `applyTime` runs immediately rather than waiting for the player's
   * timeupdate: that arrives ~4Hz and only once the seek has completed, which
   * is long enough for the highlight to visibly lag the click.
   */
  const seekToUtterance = useCallback(
    (utterance: Utterance): void => {
      const start = subtitleClip ? subtitleClip.startMs + utterance.start : utterance.start
      seekTo(start)
      applyTime(start)
    },
    [applyTime, seekTo, subtitleClip]
  )

  return (
    // The floors mirror the window's minWidth/minHeight (see main/index.ts):
    // they carry the web build, and the moments during a resize when the
    // renderer is briefly smaller than the shell allows.
    <div className="flex h-screen min-h-[650px] min-w-[1180px] flex-col overflow-hidden bg-background">
      <EditorTopBar
        name={project?.name ?? 'Loading…'}
        chatOpen={chatOpen}
        subtitlesOpen={subtitlesOpen}
        exporting={exportState.kind === 'choosing' || exportState.kind === 'running'}
        exportBlockedReason={exportBlockedReason}
        onResetLayout={resetLayout}
        onBack={onBack}
        onRename={(name) => void rename(name)}
        onToggleChat={toggleChat}
        onToggleSubtitles={toggleSubtitles}
        onExport={() => setExportSettingsOpen(true)}
      />

      <ExportSettingsDialog
        open={exportSettingsOpen}
        settings={project?.exportSettings ?? DEFAULT_EXPORT_SETTINGS}
        durationMs={timelineDurationMs}
        captionCount={utterances.length}
        sourceFrame={sourceFrame}
        codecs={exportCodecs ?? []}
        onOpenChange={setExportSettingsOpen}
        onExport={(settings) => {
          setExportSettingsOpen(false)
          // Saved on the way out, not on every keystroke: Cancel has to leave
          // the project as it was (see ExportSettingsDialog.md).
          void setExportSettings(settings).then(startExport)
        }}
      />

      <ExportDialog
        state={exportState}
        durationMs={timelineDurationMs}
        captionCount={utterances.length}
        onCancel={cancelExport}
        onDismiss={dismissExport}
      />

      {/* Full-height columns, each side one rendered only while it shows —
          not panes in the top row (see EditorPage.md). */}
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

        {/* The two flexible splits are `flex-grow` pairs off a zero basis, so a
            window resize is divided by CSS in the stated proportion and never
            reaches JS at all (see EditorPage.md). The minimums are the browser's
            to enforce too — on the two panels that must not be squeezed. */}
        <div ref={midColumnRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={topRowRef}
            className="flex min-h-0"
            style={{ flexGrow: 1 - timelineRatio, flexBasis: 0 }}
          >
            <div
              className="flex flex-col"
              style={{ flexGrow: tabsRatio, flexBasis: 0, minWidth: MIN_TABS_WIDTH }}
            >
              <Panel className="flex min-h-0 flex-1 flex-col">
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  className="flex min-h-0 flex-1 flex-col gap-0"
                >
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
                      maxChars={project?.maxChars ?? DEFAULT_MAX_CHARS}
                      onTranscribe={(config, force) => {
                        if (subtitleAssetId) void transcribe(subtitleAssetId, config, force)
                      }}
                      onEdit={openSubtitles}
                      onExportSrt={() =>
                        subtitleAssetId ? exportSrt(subtitleAssetId) : Promise.resolve(null)
                      }
                      onOpenSettings={onOpenSettings}
                      onMaxCharsChange={setMaxChars}
                    />
                  </TabsContent>
                </Tabs>
              </Panel>
            </div>

            <ResizeHandle orientation="vertical" onResize={resizeTabs} />

            <Panel
              className="flex min-h-0 min-w-0 flex-col"
              style={{ flexGrow: 1 - tabsRatio, flexBasis: 0 }}
            >
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
                  onCaptionEdit={handleCaptionEdit}
                  onCaptionStyleChange={applyStylePatch}
                  captionFontStack={captionFontStack}
                  captionStyle={captionStyle}
                  snapEnabled={snapEnabled}
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

          <Panel
            className="flex flex-col"
            style={{ flexGrow: timelineRatio, flexBasis: 0, minHeight: MIN_TIMELINE_HEIGHT }}
          >
            <TimelineToolbar
              onSplit={handleSplit}
              snapEnabled={snapEnabled}
              onToggleSnap={toggleSnap}
            />
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
              onScrub={scrubTime}
              onDropAsset={(assetId) => void addClip(assetId)}
              onTrimUtterances={handleTrimUtterances}
              onTogglePlay={togglePlay}
              onEditSubtitlesAt={openSubtitlesAt}
              snapEnabled={snapEnabled}
            />
          </Panel>
        </div>

        {/*
          Built once, then shown and hidden — not mounted and unmounted.

          Rebuilding it was the whole cost of opening this column: several
          hundred rows of fiber and DOM, thrown away on close and built again
          identically on the next open. `Activity` keeps the DOM and the state
          while `hidden` (React clears the effects, so nothing is left running
          behind it), and renders it at low priority — the work lands in idle
          time after the editor loads rather than under the click. Opening is
          then a `display` change.

          This is why `subtitleClip` falls back to `clips[0]` above: with no
          fallback the transcript would not exist until the first click, and
          there would be nothing for this to have built in advance.

          The handle is inside it, so closing takes the gap back too. The empty
          state exists for the title-bar route alone: the other two entrances
          start from a line that already exists.
        */}
        <Activity mode={subtitlesOpen ? 'visible' : 'hidden'}>
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
                onReplaceAll={handleReplaceAll}
                style={scopedStyle}
                onChange={applyStylePatch}
                scope={captionScope}
                onScopeChange={setCaptionScope}
                hasSelection={selectedLine !== null}
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-inset">
                <p className="m-0 text-center text-caption font-normal text-muted-foreground">
                  No subtitles yet — recognize this clip first.
                </p>
              </div>
            )}
          </Panel>
        </Activity>
      </div>

      {error !== null && (
        <p className="m-0 shrink-0 px-inset pb-component text-caption font-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
