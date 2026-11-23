import { toast } from "sonner";

import { packingWriteMessage } from "@/lib/packing-write-error";

/**
 * ONE result-to-toast for every packing Undo (plan, unpack, case delete,
 * rename, seal...): "Undone" is claimed ONLY when something was actually
 * undone. A restore answers `{ restored, skipped }`; when nothing came back the
 * toast says why (lines edited, packed or planned again since) instead of
 * "Undone". A seal or an already-undone change is refused by the server with
 * its own sentence, shown as the error. Shared by `use-packing-plan` and
 * `use-packing-case-writes` (R-3.1).
 */
const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

interface RestoreResult {
  restored: number;
  skipped: number;
  /** A case delete's Undo: the case itself is back, whether or not any line had to be restored. */
  recreated?: boolean;
  /** The case came back at the top level because its old parent is sealed now. */
  parentSealed?: boolean;
}

function isRestoreResult(r: unknown): r is RestoreResult {
  return !!r && typeof r === "object" && typeof (r as RestoreResult).restored === "number" && typeof (r as RestoreResult).skipped === "number";
}

/** A seal / unseal Undo that changed nothing (`changed: false`): it was already in that state. */
function isNoopToggle(r: unknown): boolean {
  return !!r && typeof r === "object" && (r as { changed?: unknown }).changed === false;
}

function announceRecreated(r: RestoreResult): void {
  const back = r.restored > 0 ? ` · ${lines(r.restored)} back` : "";
  const left = r.skipped > 0 ? ` · ${lines(r.skipped)} changed since, left as is` : "";
  const where = r.parentSealed ? " at the top level (its old case is sealed now)" : "";
  toast.success(`Case restored${where}${back}${left}`);
}

function announceResult(r: unknown): void {
  if (isNoopToggle(r)) {
    toast.info("Nothing was restored", { description: "It was already in that state." });
    return;
  }
  if (!isRestoreResult(r)) {
    toast.success("Undone");
    return;
  }
  if (r.recreated) {
    announceRecreated(r);
    return;
  }
  if (r.restored === 0) {
    toast.info("Nothing was restored", {
      description: r.skipped > 0 ? `${lines(r.skipped)} changed since (edited, packed or planned again), so ${r.skipped === 1 ? "it was" : "they were"} left as is.` : undefined,
    });
    return;
  }
  toast.success(r.skipped > 0 ? `Undone · ${lines(r.skipped)} changed since, left as is` : "Undone");
}

export function announceUndo(undo: () => Promise<unknown>): void {
  undo().then(announceResult, (e: unknown) => toast.error(packingWriteMessage(e, "Couldn't undo")));
}
