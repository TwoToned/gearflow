/**
 * The ONE server-clock window for Phase 16's exact Undos (`checkRecordWrites.
 * undoAdHocCheckNative`, `testTagRecordsWrites.undoCreateNative`). The forward save
 * stamps `serverSavedAt: Date.now()` into its own audit row; the Undo compares the
 * server's `Date.now()` against it — never the caller's `now`, which any client can
 * set. The UI offers Undo for 10 seconds; the server allows it for 10 minutes so a
 * slow network or a retried click still lands, and refuses anything older.
 */
import { ConvexError } from "convex/values";

/** How long after a save it may be undone (owner/overseer Q10). */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** Throws when `serverSavedAt` is outside the window on the server clock. */
export function assertWithinUndoWindow(serverSavedAt: number, serverNow: number, noun: "check" | "test"): void {
  if (serverNow - serverSavedAt > UNDO_WINDOW_MS) {
    throw new ConvexError(`A ${noun} can only be undone within 10 minutes of saving it`);
  }
}
