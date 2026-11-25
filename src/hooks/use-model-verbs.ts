"use client";

import { useModelWrites } from "@/hooks/use-model-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * The model page's three verbs that each toast with an exact Undo (UX Phase 12, D32): `Archive`,
 * `Restore` and `Duplicate`. Each Undo is the ONE guarded closure handed to `announceListWrite`,
 * and each reads its own audit row server-side (ids only), so it reverses exactly this write.
 * `onChanged` refreshes the page's one-shot read after the write and after its Undo.
 */
export function useModelVerbs({ onChanged, onOpenModel }: { onChanged: () => void; onOpenModel: (id: string) => void }) {
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

  async function duplicate(sourceId: string) {
    try {
      const r = await writes.duplicate(sourceId);
      announceListWrite({
        title: `Duplicated as ${r.name}`,
        undoneTitle: `Removed ${r.name}`,
        performUndo: async () => {
          await writes.undoDuplicate(r.id, r.auditId);
          onOpenModel(sourceId);
        },
      });
      onOpenModel(r.id);
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't duplicate the model" });
    }
  }

  return {
    archive: (id: string, name: string) => toggleArchive(id, name, true),
    restore: (id: string, name: string) => toggleArchive(id, name, false),
    duplicate,
  };
}
