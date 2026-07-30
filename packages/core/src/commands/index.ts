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
 * Everything a command may read or write, and nothing else: the transcripts of
 * the assets in play, by asset id.
 *
 * **An asset with no transcript is simply absent** — commands naming it report
 * no change rather than throwing, because "recognize this clip first" is a
 * normal state of the editor and not an error at this layer.
 */
export interface EditDocument {
  transcripts: Readonly<Record<string, Transcript>>
}

export interface CommandResult {
  /** The same object when nothing changed, so callers can compare by identity. */
  doc: EditDocument
  /**
   * Asset ids whose transcript is a new reference. **This is the list to
   * persist** — anything absent from it was not touched.
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

/**
 * Replay a whole edit history onto the document it started from.
 *
 * **This is the property the command model exists for**: an edit session is not
 * a sequence of states we happen to have kept, it is a list of intentions that
 * can be applied again to the same starting point and land in the same place.
 * `replay(base, log)` deep-equals what was saved, or one of the two is
 * wrong — and that equality is a test, not a hope (see commands/index.md).
 *
 * Two things had to be true before this could work, and both are enforced by
 * the types rather than by care:
 *
 * - **No command may invent identity.** `split` and `insertAfter` carry the ids
 *   they create; a replay that minted fresh ones would produce lines no later
 *   command in the list could name.
 * - **No command may read a clock or a random source.** Every field a command
 *   needs is in the command.
 *
 * A batch that changes nothing is applied all the same and changes nothing
 * again — the log records what was asked for, not what happened to work.
 */
export function replayCommands(base: EditDocument, log: EditCommand[][]): EditDocument {
  return log.reduce((doc, batch) => applyCommands(doc, batch).doc, base)
}

function missingTranscript(command: EditCommand): CommandOutcome {
  const base = { changed: false, focus: null, lines: [] }
  if (command.kind === 'subtitle.replaceAll') return { ...base, kind: command.kind, count: 0 }
  if (command.kind === 'subtitle.remove') return { ...base, kind: command.kind, removedIds: [] }
  return { ...base, kind: command.kind }
}
