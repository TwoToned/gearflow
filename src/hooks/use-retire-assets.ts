"use client";

import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useBulkAssetWrites } from "@/hooks/use-bulk-asset-writes";
import { runBulk } from "@/lib/bulk-run";
import { announceListWrite, listWriteTitle, plural } from "@/lib/list-write-toast";

/** What a surface knows about a row it offers Retire / Reinstate on. */
export interface RetireRow {
  id: string;
  /** The asset tag, named in toasts and skips. */
  tag: string;
  kind: "serialized" | "bulk";
  /** Current status, used only to skip a no-op (already retired / not retired). */
  status?: string | null;
}

/**
 * Retire and Reinstate (D33), the ONE closure behind every surface that offers
 * them: the Assets list, the asset page, the model page's Assets tab. Each write
 * is audited with an exact-Undo snapshot (`undoRetireNative`), so the toast's Undo
 * reverses exactly the rows THIS call changed, each from its own audit row, and
 * nothing that was skipped or already retired. One Undo for the whole selection,
 * handed to `announceListWrite` (a second surface that wants the same Undo is
 * given this closure, never a second implementation).
 */
export function useRetireAssets() {
  const assets = useAssetWrites();
  const bulk = useBulkAssetWrites();

  async function run(rows: RetireRow[], mode: "retire" | "reinstate") {
    const retiring = mode === "retire";
    const changed: { row: RetireRow; auditId: string }[] = [];
    const out = await runBulk(rows, {
      name: (r) => r.tag,
      gate: (r) => (retiring === (r.status === "RETIRED") ? (retiring ? "already retired" : "not retired") : null),
      apply: async (r) => {
        const w = r.kind === "bulk" ? bulk : assets;
        const res = retiring ? await w.archive(r.id) : await w.reinstate(r.id);
        if (res.undoable) changed.push({ row: r, auditId: res.auditId });
      },
    });
    const verb = retiring ? "Retired" : "Reinstated";
    announceListWrite({
      title: listWriteTitle(`${verb} ${plural(out.done.length, "asset")}`, out.skipped),
      undoneTitle: `${retiring ? "Un-retired" : "Re-retired"} ${plural(changed.length, "asset")}`,
      performUndo:
        changed.length === 0
          ? undefined
          : async () => {
              const results = await Promise.allSettled(
                changed.map(({ row, auditId }) => (row.kind === "bulk" ? bulk : assets).undoRetire(row.id, auditId)),
              );
              const failed = results.filter((r) => r.status === "rejected").length;
              if (failed > 0) return `${plural(changed.length - failed, "asset")} restored, ${failed} had moved on and ${failed === 1 ? "was" : "were"} left as ${failed === 1 ? "it is" : "they are"}`;
            },
    });
    return out;
  }

  return {
    retireMany: (rows: RetireRow[]) => run(rows, "retire"),
    reinstateMany: (rows: RetireRow[]) => run(rows, "reinstate"),
  };
}
