"use client";

import { useRef } from "react";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * "Save as new version": ONE write, ONE Undo, shared by the Versions tab
 * primary, the row ⋯ `Save a copy as new version…` and the header ⋯'s
 * `New version from vN` (R-3.1). The Undo is GUARDED (`versions.undoCreateNative`):
 * it addresses exactly the version this call created, by the create's own audit
 * id, and the server deletes it only while it is still what the save made, so an
 * Undo can never remove edited work, a quoted version or the live version.
 *
 * A ref guards double triggers (two clicks, a click and a key): one version.
 */
export function useSaveVersion(projectId: string, onSaved?: (created: { id: string; number: number }) => void) {
  const { createVersion, undoCreateVersion } = useProjectVersionWrites(projectId);
  const { viewingNumber, setViewingNumber } = useProjectVersion();
  // The Undo closure runs seconds later; read the CURRENT view through a ref.
  const viewing = useRef(viewingNumber);
  viewing.current = viewingNumber;
  const inFlight = useRef(false);
  const mutation = useServerMutation({
    mutationFn: async (opts: { fromVersionId?: string; label?: string }) => {
      const created = await createVersion(opts);
      announceListWrite({
        title: `Saved v${created.number}${opts.label ? ` “${opts.label}”` : ""}`,
        undoneTitle: `Removed v${created.number}`,
        // GUARDED: the server deletes the copy only while it is unedited, unquoted and not
        // live (`VERSION_CHANGED` / `VERSION_IS_LIVE` otherwise: the version is kept).
        performUndo: async () => {
          await undoCreateVersion(created.id, created.auditId);
          // The version on screen is gone: back to live, never a dead `?v=`.
          if (viewing.current === created.number) setViewingNumber(null);
        },
      });
      return created;
    },
    onSuccess: (created) => onSaved?.(created),
    onError: (e: Error) => showError(e, { fallbackTitle: "Couldn't save a new version" }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  return {
    isPending: mutation.isPending,
    /** Resolves once the write settles; a second call while one is in flight is a no-op. */
    save: (opts: { fromVersionId?: string; label?: string }) => {
      if (inFlight.current || mutation.isPending) return;
      inFlight.current = true;
      mutation.mutate(opts);
    },
  };
}
