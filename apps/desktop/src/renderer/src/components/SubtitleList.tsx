import { ChevronDown, Merge, Plus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { formatTimecodeFull, parseTimecode } from '@logcut/core'
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

interface SubtitleListProps {
  utterances: Utterance[]
  activeId: string | null
  /**
   * Text click: jump there but stay paused. Clicking a line has to move the
   * video — reading a line without seeing its frame is the whole reason this
   * list sits beside a player — but this click also opens the editor, and a
   * video that starts playing under the caret drags the highlight off the line
   * being typed into.
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
  const activeRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (editingId === null) activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId, editingId])

  const beginEdit = (utterance: Utterance): void => {
    editingIdRef.current = utterance.id
    draftRef.current = utterance.text
    setEditingId(utterance.id)
    setDraft(utterance.text)
  }

  const endEdit = (): void => {
    editingIdRef.current = null
    draftRef.current = ''
    setEditingId(null)
    setDraft('')
  }

  const commitEdit = (): void => {
    const id = editingIdRef.current
    if (id === null) return
    const text = draftRef.current.trim()
    endEdit()
    // Empty text cancels; unchanged text saves nothing.
    if (text === '' || text === utterances.find((u) => u.id === id)?.text) return
    onEditSave(id, text)
  }

  // Both trigger paths (timestamp and text) converge here so at most one row
  // is ever selected, and switching rows commits the previous row's edit in
  // the same render — no intermediate highlight frame.
  const selectRow = (utterance: Utterance): void => {
    if (editingIdRef.current !== null && editingIdRef.current !== utterance.id) commitEdit()
    setSelectedId(utterance.id)
  }

  const beginTimeEdit = (utterance: Utterance, edge: TimeEdge): void => {
    const text = formatTimecodeFull(utterance[edge])
    timeEditRef.current = { id: utterance.id, edge }
    timeDraftRef.current = text
    setTimeEdit({ id: utterance.id, edge })
    setTimeDraft(text)
  }

  const endTimeEdit = (): void => {
    timeEditRef.current = null
    timeDraftRef.current = ''
    setTimeEdit(null)
    setTimeDraft('')
  }

  const commitTimeEdit = (): void => {
    const target = timeEditRef.current
    if (target === null) return
    const draft = timeDraftRef.current
    const original = utterances.find((utterance) => utterance.id === target.id)
    endTimeEdit()
    // Untouched text saves nothing. The field shows hundredths while the value
    // behind it is in milliseconds, so opening a time and pressing Enter would
    // otherwise quietly round it down to the 10ms grid.
    if (original !== undefined && draft === formatTimecodeFull(original[target.edge])) return
    // Unparseable input leaves the time alone: a typo must never be read as a
    // time, and the field snapping back is the feedback.
    const parsed = parseTimecode(draft)
    if (parsed !== null) onTimeSave(target.id, target.edge, parsed)
  }

  const handleTimeKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitTimeEdit()
    } else if (event.key === 'Escape') {
      endTimeEdit()
    }
  }

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter during IME composition (Chinese input) must not commit.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      commitEdit()
    } else if (event.key === 'Escape') {
      endEdit()
    }
  }

  // The read div holds a single text node, so the range offset is the string index.
  const caretIndexAt = (event: ReactMouseEvent<HTMLDivElement>): number | null => {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY)
    if (
      range === null ||
      range.startContainer.nodeType !== Node.TEXT_NODE ||
      !event.currentTarget.contains(range.startContainer)
    ) {
      return null
    }
    return range.startOffset
  }

  /**
   * One timecode cell. A function rather than a component so the two calls
   * cannot remount their input on re-render, and so the caller can place each
   * one in its own grid row.
   */
  const timecodeCell = (utterance: Utterance, edge: TimeEdge, className: string): JSX.Element => {
    if (timeEdit?.id === utterance.id && timeEdit.edge === edge) {
      return (
        <input
          autoFocus
          className={`timecode rounded border border-primary bg-transparent px-inline py-inline text-caption outline-none ${className}`}
          value={timeDraft}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            timeDraftRef.current = event.target.value
            setTimeDraft(event.target.value)
          }}
          onKeyDown={handleTimeKeyDown}
          onBlur={commitTimeEdit}
        />
      )
    }
    return (
      <button
        type="button"
        title="Click to retype this time"
        className={`timecode cursor-text rounded border border-transparent px-inline py-inline text-left text-caption transition-colors hover:border-input ${className}`}
        onMouseDown={(event) => {
          event.preventDefault()
          selectRow(utterance)
          beginTimeEdit(utterance, edge)
        }}
      >
        {formatTimecodeFull(utterance[edge])}
      </button>
    )
  }

  const placeCaret = (event: FocusEvent<HTMLTextAreaElement>): void => {
    const length = event.target.value.length
    const index = Math.min(pendingCaretRef.current ?? length, length)
    pendingCaretRef.current = null
    event.target.setSelectionRange(index, index)
  }

  return (
    <div className="TranscribePanel flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="ConvertResult min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {utterances.map((utterance, index) => {
          const selected = utterance.id === selectedId
          const active = utterance.id === activeId
          const editing = utterance.id === editingId
          const previous = utterances[index - 1]
          // Merging is always meaningful between two lines; filling needs a
          // silence to fill. So the boundary exists wherever there is one, and
          // only Add turns itself off.
          const canAdd = previous !== undefined && utterance.start > previous.end
          return (
            <div
              key={utterance.id}
              className="ConvertItem relative"
              data-index={index}
              ref={utterance.id === activeId ? activeRef : undefined}
            >
              {/* Its own hover target: 2px of rule with 4px of slack either
                  side. No spacing token is 10px, and this is not spacing — it
                  is a hit target, sized from what it has to catch.
                  The rows' 4px of padding leaves 8px of dead space between
                  them, so the outermost pixel at each end laps onto the very
                  top of the timecode button below and the bottom of the text
                  above. Both are border, not glyph, and neither is a target. The
                  whole row used to be the trigger, which meant the divider and
                  its buttons appeared over the line above whenever the text was
                  merely being read or typed into.

                  The buttons are taller than the 6px strip and hang out of it.
                  That is fine — :hover propagates up the DOM, not the box tree,
                  so the pointer moving from the strip onto a button keeps the
                  strip hovered and the group open. They start
                  `pointer-events-none` so the invisible band never swallows a
                  click meant for a row. */}
              {previous && (
                <div className="group/gap absolute inset-x-0 top-0 z-10 flex h-[10px] -translate-y-1/2 items-center gap-component">
                  <span className="h-adjust flex-1 rounded-full bg-primary opacity-0 transition-opacity group-hover/gap:opacity-100" />
                  {/* Left in place rather than hidden when there is no gap: the
                      two kinds of boundary then look identical, nothing jumps
                      as the pointer runs down the list, and the title says why
                      it is off. */}
                  <button
                    type="button"
                    disabled={!canAdd}
                    title={
                      canAdd
                        ? 'Add a subtitle in this silence'
                        : 'These lines already touch — no silence to fill'
                    }
                    className="pointer-events-none flex h-control-sm cursor-pointer items-center gap-inline rounded-full bg-primary px-component text-caption font-medium text-primary-foreground opacity-0 shadow-md transition-opacity group-hover/gap:pointer-events-auto group-hover/gap:opacity-100 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 group-hover/gap:disabled:opacity-40"
                    onClick={() => onAdd(previous.id)}
                  >
                    <Plus size={12} />
                    Add
                  </button>
                  <button
                    type="button"
                    title="Merge with the line above"
                    className="pointer-events-none flex h-control-sm cursor-pointer items-center gap-inline rounded-full bg-primary px-component text-caption font-medium text-primary-foreground opacity-0 shadow-md transition-opacity group-hover/gap:pointer-events-auto group-hover/gap:opacity-100 hover:bg-primary/90"
                    onClick={() => onMerge(previous.id)}
                  >
                    <Merge size={12} />
                    Merge
                  </button>
                  <span className="h-adjust flex-1 rounded-full bg-primary opacity-0 transition-opacity group-hover/gap:opacity-100" />
                </div>
              )}

              <div
                className={`AimText grid grid-cols-[14ch_minmax(0,1fr)] items-start gap-x-component gap-y-inline px-inset py-inline transition-colors ${
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
                    14ch, not the 11 characters of HH:MM:SS.mm: `ch` is the
                    advance of "0" alone, and .timecode adds 0.08em of tracking
                    to every one of them, plus each box carries a border and
                    horizontal padding. */}
                {timecodeCell(utterance, 'start', 'text-muted-foreground')}

                {/* Always present, even on a line the ASR left unattributed:
                    it is the only place a speaker can be assigned, so hiding it
                    would make those lines the ones you cannot fix. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-fit cursor-pointer items-center gap-inline rounded border border-transparent px-inline py-inline text-caption font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                    >
                      <UserRound size={12} />
                      {utterance.speakerId === undefined
                        ? 'No speaker'
                        : `Speaker ${utterance.speakerId}`}
                      <ChevronDown size={12} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {speakerIds.map((speakerId) => (
                      <DropdownMenuCheckboxItem
                        key={speakerId}
                        checked={speakerId === utterance.speakerId}
                        onCheckedChange={() => onSpeakerSave(utterance.id, speakerId)}
                      >
                        <UserRound size={12} />
                        Speaker {speakerId}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {speakerIds.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => onSpeakerSave(utterance.id, nextSpeakerId)}>
                      <Plus size={12} />
                      Add new speaker
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {timecodeCell(utterance, 'end', 'text-muted-foreground/60')}

                {editing ? (
                  <textarea
                    autoFocus
                    maxLength={10000}
                    className="block w-full resize-none rounded border border-primary bg-transparent px-component py-inline text-body leading-[1.6] outline-none [field-sizing:content]"
                    value={draft}
                    onFocus={placeCaret}
                    onChange={(event) => {
                      draftRef.current = event.target.value
                      setDraft(event.target.value)
                    }}
                    onKeyDown={handleEditKeyDown}
                    onBlur={commitEdit}
                  />
                ) : (
                  // Transparent at rest, a box under the pointer: nothing else
                  // on the row says the text is editable, and a permanent
                  // outline on every line would read as a form of a hundred
                  // inputs.
                  <div
                    className="min-w-0 cursor-text rounded border border-transparent px-component py-inline text-body leading-[1.6] break-words whitespace-pre-wrap transition-colors hover:border-input"
                    onMouseDown={(event) => {
                      // The div is replaced by the textarea during this event;
                      // without preventDefault the browser would then move
                      // focus to body and immediately blur the new textarea.
                      event.preventDefault()
                      pendingCaretRef.current = caretIndexAt(event)
                      selectRow(utterance)
                      onSeek(utterance)
                      beginEdit(utterance)
                    }}
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
        })}
      </div>
    </div>
  )
}
