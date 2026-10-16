/**
 * One-level undo for destructive edits (item/category deletion).
 *
 * A snapshot is captured immediately before the deletion together with the
 * document the deletion produced. Undo is offered only while the current
 * document is still structurally identical to that post-deletion state: any
 * other change (an edit, an add, a move, opening a different menu) makes the
 * snapshot stale, and a stale snapshot is never offered — restoring it would
 * silently discard the newer work. The editor owns the state; everything
 * here is pure so it can be unit-tested without React.
 */

import type { MenuDocument } from "./schema";

export interface DeleteUndo {
  /** Document as it was immediately before the deletion. */
  before: MenuDocument;
  /** Document as it was immediately after the deletion (staleness reference). */
  after: MenuDocument;
  /** Human-readable description of what was deleted, e.g. `deleted “Espresso”.` */
  label: string;
}

/** Structural equality for plain JSON values; object key order is irrelevant. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      deepEqual(aRecord[key], bRecord[key])
  );
}

/**
 * Capture an undo slot from the document state on either side of a deletion.
 * Both documents are cloned, so later mutation of the caller's data cannot
 * corrupt the snapshot.
 */
export function captureDeleteUndo(
  before: MenuDocument,
  after: MenuDocument,
  label: string
): DeleteUndo {
  return { before: structuredClone(before), after: structuredClone(after), label };
}

/**
 * True only when `current` still matches the post-deletion document, i.e.
 * undoing cannot lose any work done since.
 */
export function canRestoreDeleteUndo(undo: DeleteUndo, current: MenuDocument): boolean {
  return deepEqual(current, undo.after);
}

/** The document to put back. Returns a fresh clone; the snapshot is reusable. */
export function restoreDeleteUndo(undo: DeleteUndo): MenuDocument {
  return structuredClone(undo.before);
}
