"use client";

import { toast } from "sonner";

import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * The register writes Test & tag mode offers (plan §3.6), each through an EXISTING
 * mutation, each reversible write with its exact reverse as Undo:
 *  - Add to the register → Undo is `undoCreateNative` (the creator, inside the window,
 *    while the item is untested and unedited).
 *  - Reactivate and test → Undo is `undoReactivateNative` (back to the status, active
 *    flag and `updatedAt` it had).
 *  - Retire from test & tag → no Undo (`reactivate` sets NOT_YET_TESTED, not the prior
 *    status), so the menu confirms first.
 */
export function useTtRegister() {
  const writes = useTestTagWrites();

  const run = async (fn: () => Promise<void>, fallbackTitle: string) => {
    try {
      await fn();
    } catch (e) {
      showError(e, { fallbackTitle });
    }
  };

  return {
    addToRegister: (asset: { id: string; assetTag: string; modelName: string | null }) =>
      run(async () => {
        const created = await writes.create({ description: asset.modelName ?? asset.assetTag, assetId: asset.id });
        announceListWrite({
          title: `${asset.assetTag} added to the test & tag register as ${created.testTagId}`,
          undoneTitle: `${created.testTagId} taken off the register`,
          performUndo: async () => {
            await writes.undoCreate(created.id);
          },
        });
      }, "Couldn't add it to the register"),
    reactivate: (tt: { id: string; testTagId: string }) =>
      run(async () => {
        await writes.reactivate(tt.id);
        announceListWrite({
          title: `${tt.testTagId} reactivated: test it now`,
          undoneTitle: `${tt.testTagId} retired again`,
          performUndo: async () => {
            await writes.undoReactivate(tt.id);
          },
        });
      }, "Couldn't reactivate it"),
    retire: (tt: { id: string; testTagId: string }) =>
      run(async () => {
        await writes.retire(tt.id);
        toast.success(`${tt.testTagId} retired from test & tag`);
      }, "Couldn't retire it"),
  };
}
