"use client";

import { toast } from "sonner";

import { useCanDo } from "@/lib/use-permissions";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { buildVersionMenuItem } from "@/lib/row-actions/job-version-menu";
import type { ActionItem } from "@/lib/primitives/types";

/**
 * The header ⋯'s version submenu (D92: no chip; ⋯ and `V`). It offers what the
 * old header pill (`version-switcher.tsx`, now unmounted) offered: switch, New
 * version from the one on screen, Compare and Manage versions…. It uses the
 * same context and the same write.
 *
 * Phase 8 contract: Phase 8 fills this same `ActionItem` shape from its own
 * Versions work. `onManage` is the header's `V` callback (the Versions panel
 * today, the Versions tab after Phase 8).
 */
export function useVersionMenuItem(onManage: () => void): ActionItem | null {
  const { projectId, versions, liveVersion, viewingNumber, setViewingNumber, openCompare } = useProjectVersion();
  const canPublish = useCanDo("invoice", "publish");
  const { createVersion } = useProjectVersionWrites(projectId);

  const create = useServerMutation({
    mutationFn: (fromVersionId: string) => createVersion({ fromVersionId }),
    onSuccess: (r) => {
      toast.success(`Created v${r.number}`);
      setViewingNumber(r.number);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return buildVersionMenuItem(
    { versions, liveVersion, viewingNumber, canPublish },
    {
      view: setViewingNumber,
      createFrom: (fromVersionId) => create.mutate(fromVersionId),
      compare: (bNumber) => openCompare({ kind: "version", number: null }, { kind: "version", number: bNumber }),
      manage: onManage,
    },
  );
}
