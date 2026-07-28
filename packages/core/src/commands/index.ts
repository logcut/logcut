import { applySubtitleCommand } from './subtitle.ts'
import type { SubtitleCommand, SubtitleOutcome } from './subtitle.ts'
import type { Transcript } from '../types.ts'

/**
 * Every edit the editor can make, as data. One union across all scopes, each
 * scope in its own module.
 *
 * **The dividing line is whether an edit is a pure transformation of the
 * document** — importing media reads the disk, transcribing costs money and
 * needs the network. Admitting those would grow every consumer a branch for
 * "this one is async", "this one can fail", "this one cannot be undone".
 */
export type EditCommand = SubtitleCommand

export type CommandOutcome = SubtitleOutcome

/**
 * Everything a command may read or write, and nothing else.
 *
 * The transcripts of the assets currently in play, by asset id. An asset with
 * no transcript is simply absent — commands naming it report no change rather
 * than throwing, because "recognize this clip first" is a normal state of the
 * editor and not an error at this layer.
 */
export interface EditDocument {
  transcripts: Readonly<Record<string, Transcript>>
}

export interface CommandResult {
  /** The same object when nothing changed, so callers can compare by identity. */
  doc: EditDocument
  /**
   * Asset ids whose transcript is a new reference. This is the list to persist:
   * anything absent from it was not touched, and rewriting it would cost a file
   * write for nothing.
   */
  changed: string[]
  /** One per command given, in the order they were given. */
  outcomes: CommandOutcome[]
}

/**
 * Apply a batch as one step.
 *
 * A batch is the unit of undo: a click sends one command, a model's turn sends
 * however many it took, and both come back as a single entry in the history.
 * Anything else and undoing one sentence of an assistant's work would leave the
 * other nine in place.
 *
 * Commands are applied in order and each sees the result of the one before it,
 * so a batch can edit the same line twice without the second edit starting from
 * a copy the first one has already replaced.
 */
export function applyCommands(doc: EditDocument, commands: EditCommand[]): CommandResult {
  let current = doc
  const changed = new Set<string>()
  const outcomes: CommandOutcome[] = []

  for (const command of commands) {
    // One scope so far. A second one dispatches on the prefix of `kind`.
    const before = current.transcripts[command.assetId]
    if (!before) {
      outcomes.push(missingTranscript(command))
      continue
    }

    const result = applySubtitleCommand(before, command)
    outcomes.push(result.outcome)
    if (result.transcript === before) continue

    current = {
      transcripts: { ...current.transcripts, [command.assetId]: result.transcript }
    }
    changed.add(command.assetId)
  }

  return { doc: current, changed: [...changed], outcomes }
}

/** One command as a batch of one. */
export function applyCommand(doc: EditDocument, command: EditCommand): CommandResult {
  return applyCommands(doc, [command])
}

function missingTranscript(command: EditCommand): CommandOutcome {
  const base = { changed: false, focus: null, lines: [] }
  if (command.kind === 'subtitle.replaceAll') return { ...base, kind: command.kind, count: 0 }
  if (command.kind === 'subtitle.remove') return { ...base, kind: command.kind, removedIds: [] }
  return { ...base, kind: command.kind }
}
