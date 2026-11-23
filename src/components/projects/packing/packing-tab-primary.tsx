"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import { usePackingTab } from "@/hooks/use-packing-tab";
import { useCanDo } from "@/lib/use-permissions";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * The Packing tab's one primary, `+ Add case`, at the right of the tab row
 * (desktop, outline: the header's `Advance to …` is the one red primary; on a
 * phone the tab renders its own red sticky bar instead). It opens the existing
 * New container sheet on the VIEWED version, with sealed cases left out of the
 * "Packed inside" list. Absent without `project:manage_line_items`.
 */
export function PackingTabPrimary({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  const canManage = useCanDo("project", "manage_line_items");
  const { viewingVersion } = useProjectVersion();
  const versionId = viewingVersion?.id;
  const { containers } = usePackingTab(projectId, orgId, versionId);
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return (
    <>
      <Button variant="line" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add case
      </Button>
      <NewContainerSheet
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        versionId={versionId}
        existingContainers={containers.map((c) => ({ id: c.id, label: c.label, sealed: c.sealedAt != null }))}
        onCreated={() => setOpen(false)}
      />
    </>
  );
}
