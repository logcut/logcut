import {
  DEFAULT_CAPTION_STYLES,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_MAX_CHARS,
  findNearestUtteranceIndex,
  findUtteranceIndexAt,
  nextSpeakerId,
  randomId,
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

/** See EditorPage.md for what each of these divides. */
const DEFAULT_TIMELINE_RATIO = 0.4
const DEFAULT_TABS_RATIO = 0.5
/** Why this one had to become draggable: SubtitleEditor.md. */
const DEFAULT_CAPTION_STYLE_RATIO = 0.4
const MIN_TIMELINE_HEIGHT = 96
/** Enough of the style panel to show a heading and a row under it, and enough
 *  of the list to show more than one line. Neither half may be dragged shut. */
const MIN_CAPTION_STYLE_HEIGHT = 120
const MIN_SUBTITLE_LIST_HEIGHT = 120
const MIN_PANES_HEIGHT = 200

const MIN_TABS_WIDTH = 260
const MIN_PLAYER_WIDTH = 360
const MIN_CHAT_WIDTH = 280
const DEFAULT_CHAT_WIDTH = 340
const MIN_SUBTITLES_WIDTH = 280
const DEFAULT_SUBTITLES_WIDTH = 340
/** Mirrors `--space-compact` — JS cannot read a CSS variable, so changing that
 *  token means changing this too. */
const PANE_GAP = 6

/** What "Reset layout" restores *and* what the editor opens on the very first
 *  time — one source, so the two cannot drift apart. */
function defaultLayout(): EditorLayout {
  return {
    chatWidth: DEFAULT_CHAT_WIDTH,
    subtitlesWidth: DEFAULT_SUBTITLES_WIDTH,
    tabsRatio: DEFAULT_TABS_RATIO,
    timelineRatio: DEFAULT_TIMELINE_RATIO,
    captionStyleRatio: DEFAULT_CAPTION_STYLE_RATIO,
    chatOpen: true,
    subtitlesOpen: false
  }
}

/** Anything that is not a fraction came from a layout that stored pixels, and
 *  the default stands in for it — see EditorLayout in shared/ipc.ts. */
function ratioOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
}

/** How long the arrangement has to sit still before it is written — see
 *  EditorPage.md. */
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
  /** Whose subtitles the editor is showing. **Deliberately not
   *  `selectedClipIds`**: selection arms Delete, and sharing one state put a
   *  "about to be deleted" border on the clip merely for editing it. */
  const [subtitleClipId, setSubtitleClipId] = useState<string | null>(null)
  /** The line the user is pointed at: nearest, so a gap still has an answer. */
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(null)
  /** The line actually playing: strict, so silence shows no caption. */
  const [captionUtteranceId, setCaptionUtteranceId] = useState<string | null>(null)
  /** Where the playhead is, on the timeline's clock. **A ref, not state** —
   *  one per-frame state cancels every bail-out on the same tree, and nothing
   *  renders this. See EditorPage.md. */
  const playheadRef = useRef(0)
  const [snapEnabled, setSnapEnabled] = useState(true)
  /** The same guard as `layoutLoaded` below, for the same reason: the default
   *  above must not be written over the stored value before it has arrived. */
  const [snapLoaded, setSnapLoaded] = useState(false)
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
  const [captionStyleRatio, setCaptionStyleRatio] = useState(DEFAULT_CAPTION_STYLE_RATIO)
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

  /** Each asset's audio envelope, fetched once and kept. Deliberately not on
   *  the asset summary — it is orders of magnitude larger than everything else
   *  there, and that shape is re-sent on every project update. */
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

  /** The encoder check only bites when there is something to burn — a timeline
   *  with no captions is copied through rather than rendered, which a build
   *  with no encoder can still do (see main/export.md). */
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

  /** Each side column's slice of the row — **0 while hidden, and no bound below
   *  may assume either column is there** (see EditorPage.md). */
  const chatSlice = (): number => (chatOpen ? chatWidth : 0)
  const subtitlesSlice = (): number => (subtitlesOpen ? subtitlesWidth : 0)

  const availableWidth = (): number => window.innerWidth - chatSlice()

  /** The two rows a ratio divides. **Measured per drag and never cached** —
   *  that is what keeps a window resize away from either split. */
  const topRowRef = useRef<HTMLDivElement>(null)
  const midColumnRef = useRef<HTMLDivElement>(null)

  /** Bounds as fractions of the room there is right now, and clamped: past the
   *  end the panel stops but an unclamped ratio would carry on, and the next
   *  widening would pay it all back at once. See EditorPage.md. */
  const resizeTabs = (delta: number): void => {
    const room = (topRowRef.current?.clientWidth ?? 0) - PANE_GAP
    if (room <= 0) return
    setTabsRatio((current) =>
      clamp(current + delta / room, MIN_TABS_WIDTH / room, 1 - MIN_PLAYER_WIDTH / room)
    )
  }

  // Handle on the right edge, so the delta is added. **Each column's bound
  // subtracts the *other* column, never itself** — see EditorPage.md, which
  // also covers why the flexible pair is subtracted at its minimum.
  const resizeChat = (delta: number): void => {
    setChatWidth((current) =>
      clamp(
        current + delta,
        MIN_CHAT_WIDTH,
        window.innerWidth - subtitlesSlice() - MIN_TABS_WIDTH - MIN_PLAYER_WIDTH
      )
    )
  }

  // Last column, so its handle is on the left edge and the sign flips.
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

  /** Put an arrangement on screen. **The two pixel widths are clamped here and
   *  the three ratios are not** — a fraction means the same thing on every
   *  display. The subtitle column's minimum comes off the chat cap whether or
   *  not it is open, since it can be opened a moment later. See EditorPage.md. */
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
    setCaptionStyleRatio(ratioOrDefault(layout.captionStyleRatio, DEFAULT_CAPTION_STYLE_RATIO))
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

  // Write it back, once it has stopped moving — see EditorPage.md.
  useEffect(() => {
    if (!layoutLoaded) return undefined
    const id = setTimeout(() => {
      void window.logcut.saveEditorLayout({
        chatWidth,
        subtitlesWidth,
        tabsRatio,
        timelineRatio,
        captionStyleRatio,
        chatOpen,
        subtitlesOpen
      })
    }, LAYOUT_SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [
    layoutLoaded,
    chatWidth,
    subtitlesWidth,
    tabsRatio,
    timelineRatio,
    captionStyleRatio,
    chatOpen,
    subtitlesOpen
  ])

  useEffect(() => {
    let cancelled = false
    void window.logcut.getSnapEnabled().then((saved) => {
      if (cancelled) return
      if (saved !== null) setSnapEnabled(saved)
      setSnapLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** No debounce, unlike the layout above: this changes on a click or a
   *  keystroke, never on every frame of a drag. */
  useEffect(() => {
    if (!snapLoaded) return
    void window.logcut.setSnapEnabled(snapEnabled)
  }, [snapLoaded, snapEnabled])

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

  /** The split inside the subtitle column; the height is reported by that
   *  column because only it knows what its toolbar already took. **Memoized,
   *  and it has to be** — it crosses two memoized children (see
   *  EditorPage.md). */
  const resizeCaptionStyle = useCallback((delta: number, room: number): void => {
    const available = room - PANE_GAP
    if (available <= 0) return
    setCaptionStyleRatio((current) =>
      clamp(
        current + delta / available,
        MIN_CAPTION_STYLE_HEIGHT / available,
        1 - MIN_SUBTITLE_LIST_HEIGHT / available
      )
    )
  }, [])

  /** The dialog speaks the transcript's own ids, the timeline speaks composite
   *  ones — the same line has two names and this is the crossing point. */
  const activeSourceId =
    utterances.find((utterance) => utterance.id === activeUtteranceId)?.sourceId ?? null

  // Memoized like every other prop that reaches a subtitle row — a fresh array
  // here defeats all of it, silently (see components/SubtitleList.tsx).
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

  /** The line the style panel calls "this line". */
  const selectedLine = utterances.find((utterance) => utterance.id === activeUtteranceId) ?? null

  /** A scope can stop existing while selected (the line is deselected, a
   *  speaker's last line is reassigned). Resolved every render rather than
   *  watched for, so no edit can land somewhere invisible. */
  const captionScope = liveScope(storedScope, speakerIds, selectedLine !== null)

  /** The selected line, but only when the panel is actually scoped to it.
   *  `selectedLine` follows the playhead and changes every frame of a drag, so
   *  pinning this to null at every other scope is what keeps the memos below —
   *  and the whole style panel — still. */
  const scopeLine = captionScope.kind === 'line' ? selectedLine : null

  const scopedStyle = useMemo(
    () => styleForScope(captionStyles, captionScope, scopeLine),
    [captionStyles, captionScope, scopeLine]
  )

  /** Where a style edit goes: the project-level scopes write the project file,
   *  a line's own styling travels as a command — see EditorPage.md. */
  const applyStylePatch = useCallback(
    (
      patch: Partial<CaptionStyle>,
      // Set while one continuous action is still under way: the panel's sliders
      // write on every frame of a drag, and an arrow key held on the picture
      // repeats — only the first write of either is a step worth going back to.
      // A drag on the picture does not need it, committing once on release
      // (see components/VideoPlayer.tsx).
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

  /** Declining here rather than in a disabled button is what lets the toolbar
   *  and the shortcut share one implementation (see TimelineToolbar.md). */
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
        timeMs: timeMs - (clip?.startMs ?? 0),
        // Minted here rather than inside the command, so the edit replays into
        // the same document rather than a similar one (see core/commands.md).
        newIds: [randomId(), randomId()]
      }
    ])
  }, [clips, dispatch, selectedUtteranceIds, utterances])

  const toggleSnap = useCallback((): void => setSnapEnabled((on) => !on), [])

  /** The single place a time becomes "which line", and it answers twice on
   *  purpose. **Using the strict test for both is what made the highlight
   *  blink off mid-drag.** Both setters bail out on an unchanged id. See
   *  EditorPage.md. */
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

  // Re-resolve both ids whenever the lines change, not only when the time does:
  // **an id does not survive an edit of the line it names** (see
  // EditorPage.md). `applyTime`'s identity already tracks `utterances`, so
  // depending on it is exactly the question that needs re-asking.
  useEffect(() => {
    applyTime(playheadRef.current)
  }, [applyTime])

  /** The scrub path into `applyTime`, collapsed to one call per frame. **The
   *  scrub path only** — callers that seek and then immediately re-derive the
   *  highlight need it to happen now, not next frame. See EditorPage.md. */
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

  // **Depend on the function, never on `playback`**: the hook returns a fresh
  // object every render, and taking the whole thing would make this — and
  // through it every handler a subtitle row holds — change on each render,
  // undoing the row memoization entirely.
  const seekPlayback = playback.seek
  const seekTo = useCallback(
    (timeMs: number): void => {
      seekPlayback(timeMs)
      applyTime(timeMs)
    },
    [applyTime, seekPlayback]
  )

  /** Show a line in the editor. **Does not seek** — so `activeUtteranceId` has
   *  to be pointed at the line here, since nothing else would move it. See
   *  Timeline.md. */
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

  /** Put the last line a batch touched in view. **Offered, never applied on its
   *  own** — each caller decides (see EditorPage.md). */
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

  /** An edit typed on the picture. It is a *timeline* line, so both its asset
   *  and the transcript's own id have to be recovered before a command can
   *  name it — the same crossing `activeSourceId` makes. */
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
      followFocus(
        dispatch([
          { kind: 'subtitle.insertAfter', assetId: subtitleAssetId, afterId, newId: randomId() }
        ])
      )
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

  /** Grouped by asset because a transcript only knows its own ids, and kept in
   *  one batch so undo gives them back the way the band took them. */
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

  /** Every window-level shortcut, in one listener so a new key cannot quietly
   *  shadow an existing one. The typing guard covers all of them — including
   *  Cmd+Z, where an input has its own undo stack. See EditorPage.md. */
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

  /** An edge dragged on the timeline: both its clock and its ids are translated
   *  back before the transcript sees them. One command per line but a single
   *  batch, so a drag across several clips stays one undo step. */
  const handleTrimUtterances = (
    edge: 'start' | 'end',
    changes: { id: string; timeMs: number }[]
  ): void => {
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

  /** `applyTime` runs immediately rather than waiting for `timeupdate`, which
   *  is long enough for the highlight to visibly lag the click. */
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
        {/* Deliberately a placeholder rather than a component of its own — see
            EditorPage.md. The handle comes with it, so closing the column also
            takes back its gap. */}
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

        {/* Built once, then shown and hidden — **not `{subtitlesOpen && …}`**
            (see EditorPage.md). **This is why `subtitleClip` falls back to
            `clips[0]` above**: with no fallback there is no transcript to build
            in advance and the whole thing is wasted. The handle is inside it,
            so closing takes the gap back too. */}
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
                styleRatio={captionStyleRatio}
                onStyleResize={resizeCaptionStyle}
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
