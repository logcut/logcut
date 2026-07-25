import { useEffect, useRef, useState } from 'react'
import type {
  FocusEvent,
  JSX,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react'
import type { Utterance } from '@logcut/core'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

interface SubtitleListProps {
  utterances: Utterance[]
  activeId: string | null
  toolbar?: ReactNode
  onSelect(utterance: Utterance): void
  onEditSave(id: string, text: string): void
}

export default function SubtitleList({
  utterances,
  activeId,
  toolbar,
  onSelect,
  onEditSave
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

  const placeCaret = (event: FocusEvent<HTMLTextAreaElement>): void => {
    const length = event.target.value.length
    const index = Math.min(pendingCaretRef.current ?? length, length)
    pendingCaretRef.current = null
    event.target.setSelectionRange(index, index)
  }

  return (
    <div className="TranscribePanel flex min-h-0 min-w-0 flex-1 flex-col border-l border-border">
      {toolbar}
      <div className="ConvertResult min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2">
        {utterances.map((utterance, index) => {
          const selected = utterance.id === selectedId
          const active = utterance.id === activeId
          const editing = utterance.id === editingId
          return (
            <div
              key={utterance.id}
              className="ConvertItem"
              data-index={index}
              ref={utterance.id === activeId ? activeRef : undefined}
            >
              <div className="AimText group flex items-start gap-2 pl-4">
                <div
                  className="relative w-12 shrink-0 cursor-pointer pt-3 text-center text-xs text-muted-foreground select-none transition-colors duration-[160ms] ease-linear hover:text-primary"
                  onMouseDown={() => {
                    selectRow(utterance)
                    onSelect(utterance)
                  }}
                >
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-xs opacity-0 transition-opacity duration-300 group-hover:text-primary group-hover:opacity-100">
                    #{index + 1}
                  </span>
                  {formatTime(utterance.start)}
                </div>
                {editing ? (
                  <textarea
                    autoFocus
                    maxLength={10000}
                    className="block flex-1 resize-none bg-transparent p-2 text-base leading-[1.6] outline-none [field-sizing:content]"
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
                  <div
                    className={`flex-1 cursor-text p-2 text-base leading-[1.6] break-words whitespace-pre-wrap transition-colors duration-[160ms] ease-linear ${
                      selected || active ? 'bg-primary/30' : 'hover:text-muted-foreground'
                    }`}
                    onMouseDown={(event) => {
                      // The div is replaced by the textarea during this event;
                      // without preventDefault the browser would then move
                      // focus to body and immediately blur the new textarea.
                      event.preventDefault()
                      pendingCaretRef.current = caretIndexAt(event)
                      selectRow(utterance)
                      beginEdit(utterance)
                    }}
                  >
                    {utterance.text}
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
