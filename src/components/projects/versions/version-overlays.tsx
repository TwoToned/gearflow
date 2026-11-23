"use client";

import { MakeLiveDialog } from "@/components/projects/versions/make-live-dialog";
import { CompareSheet } from "@/components/projects/compare/compare-sheet";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * The job page's ONE Compare sheet and ONE Make-live dialog (UX Phase 8),
 * mounted once under `ProjectVersionProvider` and driven by its state. Every
 * entry point reaches them through the context (`openCompare`, `openMakeLive`):
 * the header ⋯, the viewing strip's `Make vN live` and its drift line, a
 * Versions-tab row's ⋯, and the sheet's own footer (R-3.1). Nothing else
 * renders either.
 */
export function VersionOverlays() {
  const { projectId, orgId, versions, liveVersion, compare, openCompare, closeCompare, makeLiveTarget, openMakeLive, closeMakeLive, setViewingNumber } =
    useProjectVersion();
  return (
    <>
      {orgId && compare ? (
        <CompareSheet
          open
          onOpenChange={(open) => !open && closeCompare()}
          projectId={projectId}
          orgId={orgId}
          compare={compare}
          versions={versions}
          liveVersion={liveVersion}
          onChangeCompare={(next) => openCompare(next.a, next.b)}
          onMakeLive={(versionNumber) => {
            const target = versions.find((v) => v.number === versionNumber);
            if (target) openMakeLive(target);
          }}
        />
      ) : null}
      {makeLiveTarget ? (
        <MakeLiveDialog
          open
          onOpenChange={(open) => !open && closeMakeLive()}
          targetVersion={makeLiveTarget}
          liveVersion={liveVersion}
          projectId={projectId}
          onMadeLive={(r) => {
            if (r.conflicts.length === 0) {
              closeMakeLive();
              setViewingNumber(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
