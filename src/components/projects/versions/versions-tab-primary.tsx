"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { useCanDo } from "@/lib/use-permissions";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { SaveVersionDialog } from "@/components/projects/versions/version-dialogs";

/**
 * The Versions tab's one primary, `Save as new version`: outline in the tab row
 * on desktop; `sticky` is the phone's red bar above the bottom nav (the tab
 * body mounts it). It opens the Save dialog on the version on screen (live
 * when none), then views the copy it made. Gated by `invoice:publish`, the
 * same gate the old pill's `New version` used; absent without it.
 */
export function VersionsTabPrimary({ projectId, sticky = false }: { projectId: string; orgId?: string | undefined; sticky?: boolean }) {
  const canPublish = useCanDo("invoice", "publish");
  const { liveVersion, viewingVersion, setViewingNumber } = useProjectVersion();
  const [open, setOpen] = useState(false);
  const from = viewingVersion ?? liveVersion;
  if (!canPublish || !from) return null;

  const button = sticky ? (
    <Button className="w-full" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" />
      Save as new version
    </Button>
  ) : (
    <Button variant="line" size="sm" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" />
      Save as new version
    </Button>
  );
  return (
    <>
      {sticky ? <PinnedAboveBottomNav>{button}</PinnedAboveBottomNav> : button}
      <SaveVersionDialog open={open} onOpenChange={setOpen} projectId={projectId} fromVersion={from} onSaved={(created) => setViewingNumber(created.number)} />
    </>
  );
}
