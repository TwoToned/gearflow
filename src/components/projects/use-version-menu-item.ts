"use client";

import { useCanDo } from "@/lib/use-permissions";
import { useSaveVersion } from "@/components/projects/versions/use-save-version";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { buildVersionMenuItem } from "@/lib/row-actions/job-version-menu";
import type { ActionItem } from "@/lib/primitives/types";

/**
 * The header ⋯'s version submenu (D92: no chip; ⋯ and `V`), a DATA SPEC the
 * header mounts (never a component): switch, New version from the one on
 * screen (with Undo), Compare (opens the Compare sheet) and Manage versions…
 * (`onManage` is the header's `V` callback: it opens the Versions TAB).
 */
export function useVersionMenuItem(onManage: () => void): ActionItem | null {
  const { projectId, versions, liveVersion, viewingNumber, setViewingNumber, openCompare } = useProjectVersion();
  const canPublish = useCanDo("invoice", "publish");
  // The SAME write, Undo and double-trigger guard as the Versions tab's `Save as
  // new version` (`useSaveVersion`, R-3.1). An ActionItem has no disabled state
  // (absent, not disabled), so the hook's ref guard is what makes two triggers
  // (two clicks, a click and a key) create ONE version.
  const { save } = useSaveVersion(projectId, (created) => setViewingNumber(created.number));
  const createFrom = (fromVersionId: string) => save({ fromVersionId });

  return buildVersionMenuItem(
    { versions, liveVersion, viewingNumber, canPublish },
    {
      view: setViewingNumber,
      createFrom,
      compare: (bNumber) => openCompare({ kind: "version", number: null }, { kind: "version", number: bNumber }),
      manage: onManage,
    },
  );
}
