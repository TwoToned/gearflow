"use client";

import { useRef } from "react";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * "Save as new version": ONE write, ONE Undo, shared by the Versions tab
 * primary, the row ⋯ `Save a copy as new version…` and the header ⋯'s
 * `New version from vN` (R-3.1). The Undo deletes exactly the version this
 * call created (its id comes from the write's own result, never from the
 * client's idea of "the newest one"); `deleteNative` refuses the live version
 * server-side, so Undo can never remove live data.
 *
 * A ref guards double triggers (two clicks, a click and a key): one version.
 */
export function useSaveVersion(projectId: string, onSaved?: (created: { id: string; number: number }) => void) {
  const { createVersion, deleteVersion } = useProjectVersionWrites(projectId);
  const inFlight = useRef(false);
  const mutation = useServerMutation({
    mutationFn: async (opts: { fromVersionId?: string; label?: string }) => {
      const created = await createVersion(opts);
      announceListWrite({
        title: `Saved v${created.number}${opts.label ? ` “${opts.label}”` : ""}`,
        undoneTitle: `Removed v${created.number}`,
        performUndo: async () => {
          await deleteVersion(created.id);
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
