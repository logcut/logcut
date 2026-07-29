import { ChevronDown, Merge, Plus, UserRound } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FocusEvent,
  JSX,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react'
import { clampUtteranceTime, formatTimecodeFull, parseTimecode } from '@logcut/core'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { Utterance } from '@logcut/core'

type TimeEdge = 'start' | 'end'

/**
 * How far a timecode moves per pixel dragged, and how far the pointer has to
 * travel before a press counts as a drag at all.
 *
 * 10ms is the grid the field displays anyway (see core/timecode.md), so a drag
 * cannot produce a value the label could not show. The threshold is what keeps
 * click-to-type working: a click always jitters a pixel or two.
 */
const MS_PER_PIXEL = 10
const DRAG_THRESHOLD_PX = 3

/** How much of the remaining distance the list closes each frame while
 *  chasing the active line. ~0.15 arrives smoothly in about 200ms. */
const FOLLOW_EASE = 0.15

/** How long the follow stays quiet after an action that anchored the view
 *  itself — long enough for a seek to make its way back through the
 *  element's events. */
const FOLLOW_QUIET_MS = 400

/**
 * Everything a row can do, in one object with a stable identity.
 *
 * One bundle rather than a dozen callback props: the row is memoized and this
 * list re-renders at pointer rate, so every extra prop is another value the
 * shallow compare walks each time.
 *
 * The edit state machine stays in the list. Rows only report events.
 */
interface RowHandlers {
  onTextPress(event: ReactMouseEvent<HTMLDivElement>, utterance: Utterance): void
  onDraftChange(value: string): void
  onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void
  onEditBlur(): void
  onPlaceCaret(event: FocusEvent<HTMLTextAreaElement>): void

  onTimePress(
    event: ReactPointerEvent<HTMLButtonElement>,
    utterance: Utterance,
    edge: TimeEdge
  ): void
  onTimeMove(event: ReactPointerEvent<HTMLButtonElement>): void
  onTimeRelease(event: ReactPointerEvent<HTMLButtonElement>, utterance: Utterance): void
  onTimeDraftChange(value: string): void
  onTimeKeyDown(event: KeyboardEvent<HTMLInputElement>): void
  onTimeBlur(): void

  onAdd(afterId: string): void
  onMerge(firstId: string): void
  onSpeakerSave(id: string, speakerId: string): void
}

interface SubtitleRowProps {
  utterance: Utterance
  /** The line above, or undefined for the first — nothing borders it there. */
  previous: Utterance | undefined
  index: number
  active: boolean
  selected: boolean
  editing: boolean
  /** Only ever the editing row's draft; every other row is handed ''. */
  draft: string
  /** Which of this row's timecodes is open for typing, if either. */
  timeEditEdge: TimeEdge | null
  timeDraft: string
  speakerIds: string[]
  nextSpeakerId: string
  /** Attached only while this row is the active one, so the follow below can
   *  measure where it currently sits. */
  activeRef: RefObject<HTMLDivElement | null>
  handlers: RowHandlers
}

/**
 * One line.
 *
 * **Memoized, and every prop above is either a primitive or something the
 * list pins.** Scrubbing drags the highlight along at pointer rate; unmemoized
 * that re-rendered the whole list — twenty-odd elements and a Radix dropdown
 * per row — hundreds of times a second.
 *
 * **One prop rebuilt on each of the list's renders — a fresh array, an inline
 * arrow — defeats the shallow compare completely, and silently.** If this ever
 * feels slow again, look at what is passed in before changing anything here.
 */
const SubtitleRow = memo(function SubtitleRow({
  utterance,
  previous,
  index,
  active,
  selected,
  editing,
  draft,
  timeEditEdge,
  timeDraft,
  speakerIds,
  nextSpeakerId,
  activeRef,
  handlers
}: SubtitleRowProps): JSX.Element {
  /**
   * Whether this row's speaker menu exists yet. Until it is pressed the row
   * renders a plain button and no Radix at all — the whole list mounts at once
   * (no virtualisation, on purpose — see SubtitleList.md), so a dropdown per row
   * would mean several hundred Radix roots in the one render that opens the
   * panel.
   *
   * **It never goes back to false.** Tearing a menu down takes its trigger with
   * it, and Radix returns focus to the trigger on close — to a node that no
   * longer exists. Some rows carrying a menu is the intended end state.
   */
  const [menuMounted, setMenuMounted] = useState(false)

  /** The same button either way: as the menu's trigger once there is a menu,
   *  and as the thing that brings one into being before that. */
  const speakerButton = (onClick?: () => void): JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit cursor-pointer items-center gap-inline rounded border border-transparent px-inline py-inline text-caption font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
    >
      <UserRound size={12} />
      {utterance.speakerId === undefined ? 'No speaker' : `Speaker ${utterance.speakerId}`}
      <ChevronDown size={12} />
    </button>
  )

  const timecodeCell = (edge: TimeEdge, className: string): JSX.Element => {
    if (timeEditEdge === edge) {
      return (
        <input
          autoFocus
          className={`timecode w-[14ch] rounded border border-primary bg-transparent px-inline py-inline text-caption outline-none ${className}`}
          value={timeDraft}
          onFocus={(event) => event.target.select()}
          onChange={(event) => handlers.onTimeDraftChange(event.target.value)}
          onKeyDown={handlers.onTimeKeyDown}
          onBlur={handlers.onTimeBlur}
        />
      )
    }
    return (
      <button
        type="button"
        title="Click to retype this time, or drag sideways"
        className={`timecode w-[14ch] cursor-ew-resize rounded border border-transparent px-inline py-inline text-left text-caption transition-colors hover:border-input ${className}`}
        onPointerDown={(event) => handlers.onTimePress(event, utterance, edge)}
        onPointerMove={handlers.onTimeMove}
        onPointerUp={(event) => handlers.onTimeRelease(event, utterance)}
        onPointerCancel={(event) => handlers.onTimeRelease(event, utterance)}
      >
        {formatTimecodeFull(utterance[edge])}
      </button>
    )
  }

  return (
    <div
      // A rule between lines, and only between them: `previous` is what marks
      // a boundary that has a line on both sides. On the first row it would
      // land against the section above and read as a double border.
      //
      // **No `relative` here.** The row must carry no positioned descendant,
      // or `content-visibility` cannot go on it — see SubtitleList.md. The
      // controls that sit on this edge live in one shared GapOverlay instead.
      //
      // `data-index` is how that overlay finds which boundary the pointer is
      // near, so it is load-bearing, not a debugging aid.
      className={`ConvertItem ${previous ? 'border-t border-border' : ''}`}
      data-index={index}
      ref={active ? activeRef : undefined}
    >
      <div
        className={`AimText grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-component gap-y-inline px-inset py-inline transition-colors ${
          selected || active ? 'bg-muted/60' : ''
        }`}
      >
        {/* A two-row grid, not two stacked columns: the pairs have to
                  line up — start beside the speaker, end beside the text —
                  and two independent flex columns only line up by accident,
                  which is exactly how they drifted apart.
                  All four cells carry the same `py-inline`, which is what
                  actually does the aligning. Padding only the one cell that
                  sat beside the taller text lined the words up but left the
                  two timecode boxes 16px apart — and they are the same
                  control, so they have to be the same size.
                  The first column is `auto`, and the width lives on the cells
                  themselves. `ch` is resolved against the element it is
                  written on: in `grid-cols` that is the row — sans, 16px —
                  which asked for 134px to hold 92px of monospace and left a
                  42px hole between the time and the speaker.

                  14ch rather than the 11 characters of HH:MM:SS.mm because
                  `ch` is the advance of "0" alone, while .timecode adds
                  0.08em of tracking to every one of them, and each box
                  carries a border and horizontal padding. */}
        {timecodeCell('start', 'text-muted-foreground')}

        {/* Always present, even on a line the ASR left unattributed:
                  it is the only place a speaker can be assigned, so hiding it
                  would make those lines the ones you cannot fix.
                  The menu behind it is not — see `menuMounted`. */}
        {menuMounted ? (
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger asChild>{speakerButton()}</DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {speakerIds.map((speakerId) => (
                <DropdownMenuCheckboxItem
                  key={speakerId}
                  checked={speakerId === utterance.speakerId}
                  onCheckedChange={() => handlers.onSpeakerSave(utterance.id, speakerId)}
                >
                  <UserRound size={12} />
                  Speaker {speakerId}
                </DropdownMenuCheckboxItem>
              ))}
              {speakerIds.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => handlers.onSpeakerSave(utterance.id, nextSpeakerId)}
              >
                <Plus size={12} />
                Add new speaker
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          speakerButton(() => setMenuMounted(true))
        )}

        {timecodeCell('end', 'text-muted-foreground/60')}

        {editing ? (
          <textarea
            autoFocus
            maxLength={10000}
            className="block w-full resize-none rounded border border-primary bg-transparent px-component py-inline text-body leading-[1.6] outline-none [field-sizing:content]"
            value={draft}
            onFocus={handlers.onPlaceCaret}
            onChange={(event) => handlers.onDraftChange(event.target.value)}
            onKeyDown={handlers.onEditKeyDown}
            onBlur={handlers.onEditBlur}
          />
        ) : (
          // Transparent at rest, a box under the pointer: nothing else
          // on the row says the text is editable, and a permanent
          // outline on every line would read as a form of a hundred
          // inputs.
          <div
            className="min-w-0 cursor-text rounded border border-transparent px-component py-inline text-body leading-[1.6] break-words whitespace-pre-wrap transition-colors hover:border-input"
            onMouseDown={(event) => handlers.onTextPress(event, utterance)}
          >
            {utterance.text === '' ? (
              <span className="text-muted-foreground italic">Empty line</span>
            ) : (
              utterance.text
            )}
          </div>
        )}
      </div>
    </div>
  )
})

/**
 * Half the hover band around a boundary: 2px of rule with 6px of slack either
 * side, so 7px above and below the edge itself.
 *
 * Not a spacing token — this is a hit target, sized from what it has to catch.
 * The rows' 4px of padding leaves only 8px of dead space between two lines, so
 * the outer 3px at each end laps onto the row beyond: the very top of the
 * timecode button below, the bottom of the text above. Those bands are border
 * and half-leading rather than glyph, so nothing legible is covered — but the
 * timecode *is* draggable, and a press within 3px of a row's top edge is
 * caught here instead.
 */
const GAP_HIT_PX = 7

interface GapPosition {
  /** Index of the line *above* the boundary. */
  index: number
  /** Distance from the top of the scrolled content, not the viewport. */
  top: number
}

/**
 * The Add / Merge controls, on whichever boundary the pointer is near.
 *
 * **One of these for the whole list, not one per row.** Per row it was two
 * positioned elements each — the row itself and the strip — so several hundred
 * lines meant several hundred paint layers to organise and property nodes to
 * walk every time the column was shown, for controls nobody was pointing at.
 * It also forced `content-visibility` down onto the row's inner grid, because
 * that property implies `contain: paint` and the strip deliberately hangs half
 * outside the row's box.
 *
 * **The state lives here rather than in the list.** A `setState` in the list
 * would re-run `utterances.map` and rebuild every element — `memo` stops rows
 * re-rendering but cannot stop them being created — so the pointer crossing the
 * list would cost more than opening it ever did. Here it re-renders one node.
 *
 * And it only sets state when the boundary actually *changes*: moving within
 * one band returns the same object and React bails out.
 */
function GapOverlay({
  scroller,
  utterances,
  handlers
}: {
  scroller: RefObject<HTMLDivElement | null>
  utterances: Utterance[]
  handlers: RowHandlers
}): JSX.Element | null {
  const [gap, setGap] = useState<GapPosition | null>(null)
  const count = utterances.length

  useEffect(() => {
    const element = scroller.current
    if (element === null) return undefined

    const locate = (event: PointerEvent): GapPosition | null => {
      const target = event.target
      if (!(target instanceof Element)) return null
      const row = target.closest('[data-index]')
      if (!(row instanceof HTMLElement)) return null
      const index = Number(row.dataset.index)
      const rect = row.getBoundingClientRect()
      // Measured against the scroller and offset by how far it is scrolled:
      // the overlay is absolute *inside* the scrolled content, so it travels
      // with the rows and needs no scroll listener of its own.
      const box = element.getBoundingClientRect()
      const toContent = (viewportY: number): number => viewportY - box.top + element.scrollTop
      // The first line has no boundary above it and the last none below —
      // there has to be a line on both sides for Add or Merge to mean anything.
      if (event.clientY - rect.top <= GAP_HIT_PX && index > 0) {
        return { index: index - 1, top: toContent(rect.top) }
      }
      if (rect.bottom - event.clientY <= GAP_HIT_PX && index < count - 1) {
        return { index, top: toContent(rect.bottom) }
      }
      return null
    }

    const onMove = (event: PointerEvent): void => {
      // Over the controls themselves, leave the boundary alone. They are not
      // rows, so locating would come back empty and take the overlay out from
      // under the pointer before the click landed.
      if (event.target instanceof Element && event.target.closest('[data-gap]')) return
      const next = locate(event)
      setGap((current) => {
        if (current === null || next === null) return current === next ? current : next
        return current.index === next.index ? current : next
      })
    }
    const onLeave = (): void => setGap(null)

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    return () => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
    }
  }, [scroller, count])

  if (gap === null) return null
  const above = utterances[gap.index]
  const below = utterances[gap.index + 1]
  if (above === undefined || below === undefined) return null
  // Merging is always meaningful between two lines; filling needs a silence to
  // fill. So only Add turns itself off.
  const canAdd = below.start > above.end

  return (
    <div
      data-gap
      className="absolute inset-x-0 z-10 flex h-[14px] -translate-y-1/2 animate-in items-center gap-component fade-in-0"
      style={{ top: gap.top }}
    >
      <span className="h-adjust flex-1 rounded-full bg-primary" />
      {/* Left in place rather than hidden when there is no gap: the two kinds
          of boundary then look identical, nothing jumps as the pointer runs
          down the list, and the title says why it is off. */}
      <button
        type="button"
        disabled={!canAdd}
        title={
          canAdd
            ? 'Add a subtitle in this silence'
            : 'These lines already touch — no silence to fill'
        }
        className={`flex h-control-sm items-center gap-inline rounded-full bg-primary px-component text-caption font-medium text-primary-foreground shadow-md ${
          canAdd ? 'cursor-pointer hover:bg-primary/90' : 'cursor-not-allowed opacity-40'
        }`}
        onClick={() => handlers.onAdd(above.id)}
      >
        <Plus size={12} />
        Add
      </button>
      <button
        type="button"
        title="Merge with the line above"
        className="flex h-control-sm cursor-pointer items-center gap-inline rounded-full bg-primary px-component text-caption font-medium text-primary-foreground shadow-md hover:bg-primary/90"
        onClick={() => handlers.onMerge(above.id)}
      >
        <Merge size={12} />
        Merge
      </button>
      <span className="h-adjust flex-1 rounded-full bg-primary" />
    </div>
  )
}

interface SubtitleListProps {
  utterances: Utterance[]
  activeId: string | null
  /**
   * Text click: jump there but stay paused. The same click opens the editor, and
   * a video playing on under the caret drags the highlight off the line being
   * typed into.
   */
  onSeek(utterance: Utterance): void
  /** A timecode was retyped. Bounds are core's problem, not this component's. */
  onTimeSave(id: string, edge: TimeEdge, timeMs: number): void
  onEditSave(id: string, text: string): void
  /** Fill the silence after this line with a new, empty one. */
  onAdd(afterId: string): void
  /** Fold the line after this one into it, gap and all. */
  onMerge(firstId: string): void
  /** Every speaker in this transcript, in the order to list them. */
  speakerIds: string[]
  /** The id "Add new speaker" would hand out. */
  nextSpeakerId: string
  onSpeakerSave(id: string, speakerId: string): void
}

export default function SubtitleList({
  utterances,
  activeId,
  onSeek,
  onEditSave,
  onTimeSave,
  onAdd,
  onMerge,
  speakerIds,
  nextSpeakerId,
  onSpeakerSave
}: SubtitleListProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Ref mirrors of the edit state: row switches happen on mousedown, before the
  // old textarea's blur, so commits must read current values synchronously and
  // stay idempotent when the blur fires (or never fires) afterwards.
  const editingIdRef = useRef<string | null>(null)
  const draftRef = useRef('')
  const pendingCaretRef = useRef<number | null>(null)
  // Timecodes edit independently of the text, but need the same ref mirrors:
  // clicking another field commits this one on mousedown, before its blur.
  const [timeEdit, setTimeEdit] = useState<{ id: string; edge: TimeEdge } | null>(null)
  const [timeDraft, setTimeDraft] = useState('')
  const timeEditRef = useRef<{ id: string; edge: TimeEdge } | null>(null)
  const timeDraftRef = useRef('')
  // A drag in progress. Entirely in a ref, and the preview is written straight
  // to the element's text: this fires per pointermove, and re-rendering a list
  // of a thousand rows at that rate is exactly the kind of thing the playhead
  // avoids the same way.
  const scrubRef = useRef<{
    id: string
    edge: TimeEdge
    element: HTMLElement
    originX: number
    originMs: number
    valueMs: number
    moved: boolean
  } | null>(null)

  // `utterances` through a ref as well: the handlers below read it, and
  // depending on it directly would rebuild the whole bundle — and with it
  // re-render every row — on any edit at all.
  const utterancesRef = useRef(utterances)
  utterancesRef.current = utterances
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  /**
   * When the follow may resume. An action whose result is already where the user
   * is looking pushes this out.
   *
   * **A window, not a one-shot flag**: one action changes `activeId` more than
   * once — adding a line writes the transcript *and* seeks, and the seek reports
   * back later, against a transcript that by then resolves differently. A flag
   * cleared by the first change let the second one recentre.
   *
   * Set where the action happens, never inferred from what `activeId` did.
   */
  const followQuietUntilRef = useRef(0)
  const holdFollow = useCallback((): void => {
    followQuietUntilRef.current = performance.now() + FOLLOW_QUIET_MS
  }, [])

  /**
   * Glide the active line to the middle using spring physics.
   *
   * **Not `scrollIntoView`.** Plain, it teleports. Smooth is worse: dragging the
   * timeline re-targets it every frame and each call restarts the browser's
   * ~300ms animation, so the list never arrives anywhere. A spring converges
   * however often the target moves, and feels more natural than linear easing.
   *
   * Measured with rects, not `offsetTop`: nothing between the rows and the
   * scroller is positioned, so offsets would be relative to something further up
   * the tree entirely.
   *
   * **The frame handle is a local, and the cleanup is this effect's own.** Held
   * in a ref, guarded by `if (ref.current === 0)` and cancelled from a
   * mount-only effect that never reset it, StrictMode's remount left a stale
   * handle and the guard refused to schedule anything ever again — dead in
   * development from the first render, and nothing about it looked broken.
   *
   * Not while a row is being edited: the list must not move under the caret.
   */
  useEffect(() => {
    if (editingId !== null) return
    // An action just put the active line where the user is already looking;
    // centring it now would shift everything around it instead.
    if (performance.now() < followQuietUntilRef.current) return

    let frame = 0

    const step = (): void => {
      const list = listRef.current
      const row = activeRef.current
      // The row ref may not be set yet if React hasn't finished rendering the
      // new active line. Keep trying for a few frames.
      if (!list || !row) {
        frame = requestAnimationFrame(step)
        return
      }

      const listBox = list.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      // How far the row's centre is from the list's centre. Positive means
      // the row is below where it should be.
      const delta = rowBox.top + rowBox.height / 2 - (listBox.top + listBox.height / 2)

      // Close enough: stop chasing.
      if (Math.abs(delta) < 0.5) return

      const before = list.scrollTop
      list.scrollTop = before + delta * FOLLOW_EASE
      // Already against an end: the row cannot come any closer to the middle,
      // and without this the loop would spin forever on the first and last
      // few lines.
      if (list.scrollTop === before) return
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [activeId, editingId])

  const beginEdit = useCallback((utterance: Utterance): void => {
    editingIdRef.current = utterance.id
    draftRef.current = utterance.text
    setEditingId(utterance.id)
    setDraft(utterance.text)
  }, [])

  const endEdit = useCallback((): void => {
    // Leaving an edit is the other action whose result is already where the
    // user is looking. `editingId` going back to null restarts the follow, and
    // it would pull the line just typed into towards the middle — the list
    // jumping the instant Enter is pressed. Covers Escape and blur too, both
    // of which come through here.
    holdFollow()
    editingIdRef.current = null
    draftRef.current = ''
    setEditingId(null)
    setDraft('')
  }, [holdFollow])

  const commitEdit = useCallback((): void => {
    const id = editingIdRef.current
    if (id === null) return
    const text = draftRef.current.trim()
    endEdit()
    // Empty text cancels; unchanged text saves nothing.
    if (text === '' || text === utterancesRef.current.find((u) => u.id === id)?.text) return
    onEditSave(id, text)
  }, [endEdit, onEditSave])

  // Both trigger paths (timestamp and text) converge here so at most one row
  // is ever selected, and switching rows commits the previous row's edit in
  // the same render — no intermediate highlight frame.
  const selectRow = useCallback(
    (utterance: Utterance): void => {
      if (editingIdRef.current !== null && editingIdRef.current !== utterance.id) commitEdit()
      setSelectedId(utterance.id)
    },
    [commitEdit]
  )

  const beginTimeEdit = useCallback((utterance: Utterance, edge: TimeEdge): void => {
    const text = formatTimecodeFull(utterance[edge])
    timeEditRef.current = { id: utterance.id, edge }
    timeDraftRef.current = text
    setTimeEdit({ id: utterance.id, edge })
    setTimeDraft(text)
  }, [])

  const endTimeEdit = useCallback((): void => {
    timeEditRef.current = null
    timeDraftRef.current = ''
    setTimeEdit(null)
    setTimeDraft('')
  }, [])

  const commitTimeEdit = useCallback((): void => {
    const target = timeEditRef.current
    if (target === null) return
    const typed = timeDraftRef.current
    const original = utterancesRef.current.find((utterance) => utterance.id === target.id)
    endTimeEdit()
    // Untouched text saves nothing. The field shows hundredths while the value
    // behind it is in milliseconds, so opening a time and pressing Enter would
    // otherwise quietly round it down to the 10ms grid.
    if (original !== undefined && typed === formatTimecodeFull(original[target.edge])) return
    // Unparseable input leaves the time alone: a typo must never be read as a
    // time, and the field snapping back is the feedback.
    const parsed = parseTimecode(typed)
    if (parsed !== null) onTimeSave(target.id, target.edge, parsed)
  }, [endTimeEdit, onTimeSave])

  const handlers = useMemo<RowHandlers>(
    () => ({
      onTextPress: (event, utterance) => {
        // The div is replaced by the textarea during this event; without
        // preventDefault the browser would then move focus to body and
        // immediately blur the new textarea.
        event.preventDefault()
        // The read div holds a single text node, so the range offset is the
        // string index.
        const range = document.caretRangeFromPoint(event.clientX, event.clientY)
        pendingCaretRef.current =
          range !== null &&
          range.startContainer.nodeType === Node.TEXT_NODE &&
          event.currentTarget.contains(range.startContainer)
            ? range.startOffset
            : null
        selectRow(utterance)
        onSeek(utterance)
        beginEdit(utterance)
      },
      onDraftChange: (value) => {
        draftRef.current = value
        setDraft(value)
      },
      onEditKeyDown: (event) => {
        // Enter during IME composition (Chinese input) must not commit.
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          commitEdit()
        } else if (event.key === 'Escape') {
          endEdit()
        }
      },
      onEditBlur: commitEdit,
      onPlaceCaret: (event) => {
        const length = event.target.value.length
        const index = Math.min(pendingCaretRef.current ?? length, length)
        pendingCaretRef.current = null
        event.target.setSelectionRange(index, index)
      },

      onTimePress: (event, utterance, edge) => {
        // Stops the press from selecting text across the list while dragging.
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        selectRow(utterance)
        scrubRef.current = {
          id: utterance.id,
          edge,
          element: event.currentTarget,
          originX: event.clientX,
          originMs: utterance[edge],
          valueMs: utterance[edge],
          moved: false
        }
      },
      onTimeMove: (event) => {
        const scrub = scrubRef.current
        if (scrub === null) return
        const dx = event.clientX - scrub.originX
        if (!scrub.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        scrub.moved = true
        // The same clamp the commit will apply, so the number never jumps on
        // release.
        scrub.valueMs = clampUtteranceTime(
          utterancesRef.current,
          scrub.id,
          scrub.edge,
          scrub.originMs + dx * MS_PER_PIXEL
        )
        scrub.element.textContent = formatTimecodeFull(scrub.valueMs)
      },
      onTimeRelease: (event, utterance) => {
        const scrub = scrubRef.current
        scrubRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        if (scrub === null) return

        // Never moved: it was a click, so open the field instead.
        if (!scrub.moved) {
          beginTimeEdit(utterance, scrub.edge)
          return
        }
        if (scrub.valueMs !== scrub.originMs) {
          onTimeSave(scrub.id, scrub.edge, scrub.valueMs)
          return
        }
        // Dragged but landed back on the original — nothing will re-render, so
        // the text written during the drag has to be put back by hand.
        scrub.element.textContent = formatTimecodeFull(scrub.originMs)
      },
      onTimeDraftChange: (value) => {
        timeDraftRef.current = value
        setTimeDraft(value)
      },
      onTimeKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commitTimeEdit()
        } else if (event.key === 'Escape') {
          endTimeEdit()
        }
      },
      onTimeBlur: commitTimeEdit,

      onAdd: (afterId: string) => {
        holdFollow()
        onAdd(afterId)
      },
      onMerge,
      onSpeakerSave
    }),
    [
      beginEdit,
      beginTimeEdit,
      commitEdit,
      commitTimeEdit,
      endEdit,
      endTimeEdit,
      holdFollow,
      onAdd,
      onMerge,
      onSeek,
      onSpeakerSave,
      onTimeSave,
      selectRow
    ]
  )

  return (
    <div className="TranscribePanel flex min-h-0 min-w-0 flex-1 flex-col">
      {/* `relative` so the overlay below positions against the scrolled
          content and rides along with it. */}
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <GapOverlay scroller={listRef} utterances={utterances} handlers={handlers} />
        {utterances.map((utterance, index) => {
          const editing = utterance.id === editingId
          const timeEditEdge = timeEdit?.id === utterance.id ? timeEdit.edge : null
          return (
            <SubtitleRow
              key={utterance.id}
              utterance={utterance}
              previous={utterances[index - 1]}
              index={index}
              active={utterance.id === activeId}
              selected={utterance.id === selectedId}
              editing={editing}
              // Handed only to the row it belongs to. Giving the live draft to
              // every row would put each keystroke through the whole list,
              // which is the cost this memoization exists to remove.
              draft={editing ? draft : ''}
              timeEditEdge={timeEditEdge}
              timeDraft={timeEditEdge === null ? '' : timeDraft}
              speakerIds={speakerIds}
              nextSpeakerId={nextSpeakerId}
              activeRef={activeRef}
              handlers={handlers}
            />
          )
        })}
      </div>
    </div>
  )
}
