"use client";

import { useModelWrites } from "@/hooks/use-model-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * The model page's verbs that each toast with an exact Undo (UX Phase 12, D32): `Archive` and
 * `Restore`. Each Undo is the ONE guarded closure handed to `announceListWrite`,
 * and each reads its own audit row server-side (ids only), so it reverses exactly this write.
 * `onChanged` refreshes the page's one-shot read after the write and after its Undo.
 */
export function useModelVerbs({ onChanged }: { onChanged: () => void }) {
  const writes = useModelWrites();

  async function toggleArchive(id: string, name: string, archive: boolean) {
    try {
      const r = await (archive ? writes.archive(id) : writes.restore(id));
      onChanged();
      announceListWrite({
        title: `${archive ? "Archived" : "Restored"} ${name}`,
        undoneTitle: `${archive ? "Restored" : "Re-archived"} ${name}`,
        performUndo: r.undoable
          ? async () => {
              await writes.undoArchive(id, r.auditId);
              onChanged();
            }
          : undefined,
      });
    } catch (e) {
      showError(e, { fallbackTitle: archive ? "Couldn't archive the model" : "Couldn't restore the model" });
    }
  }

  return {
    archive: (id: string, name: string) => toggleArchive(id, name, true),
    restore: (id: string, name: string) => toggleArchive(id, name, false),
  };
}
