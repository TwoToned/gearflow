"use client";

export interface PromoteRevisionResult {
  conflicts: string[];
  autoSavedRevision?: number;
  liveRevision: number;
}

/**
 * #1229 Phase 3 note: the two mutations this hook wrapped —
 * `projectVersionsWrites.saveVersionNative` (#1080/#1085) and
 * `projectVersionsWrites.promoteRevisionNative` (#1080/#1089) — were BOTH
 * DELETED, superseded by the real `projectVersions`-table verb set in
 * `convex/versions.ts` (`createNative`/`makeLiveNative`). Unlike
 * `use-quote-writes.ts`'s deleted verbs, these two have no 1:1 argument-shape
 * mapping onto their replacements (this hook's callers work in `revision`
 * NUMBERS off the older quote/snapshot model; the new verbs take a
 * `projectVersions` row's own `id`) — rewiring `version-switcher.tsx` /
 * `promote-version-dialog.tsx` onto `versions.createNative`/`makeLiveNative`
 * is Phase 5's UI work, not a mechanical rename. Left as clear, throwing
 * stubs (rather than removed methods + broken call sites) — both call sites
 * already catch and toast/report the error. See FEATUREDOCS/76's Phase 3
 * section.
 */
export function useProjectVersionWrites() {
  return {
    /** See the file header — `saveVersionNative` was deleted in #1229 Phase 3. */
    saveVersion: async (
      _projectId: string,
      _label?: string,
    ): Promise<{ id: string; version: number; savedRevision: number }> => {
      throw new Error(
        "Adding a version is temporarily unavailable — project versioning has moved to the new versions.* mutations (#1229) and this action's UI hasn't been rebuilt on them yet.",
      );
    },

    /** See the file header — `promoteRevisionNative` was deleted in #1229 Phase 3. */
    promoteRevision: async (_projectId: string, _targetRevision: number): Promise<PromoteRevisionResult> => {
      throw new Error(
        "Making a version live is temporarily unavailable — project versioning has moved to the new versions.* mutations (#1229) and this action's UI hasn't been rebuilt on them yet.",
      );
    },
  };
}
