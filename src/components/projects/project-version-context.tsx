"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { projectSnapshotEntries, type ProjectedView, type SnapshotEntryLike } from "@/lib/project-version-projection";

/**
 * Phase 3 (#1080/#1093) — the version-switching seam. Which version is being
 * VIEWED is a per-user URL param (`?v=`), never a database field (design doc
 * §3.1) — two people can view different versions of the same project at once
 * and neither affects the other or the live data. Mounted once above the
 * tabs (`ProjectDetailPage`); every tab that wants to project a version reads
 * `useProjectVersion()` rather than fetching its own snapshot entries.
 */

export interface ProjectVersionListItem {
  revision: number;
  quoteId: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "SUPERSEDED" | "EXPIRED";
  isLive: boolean;
  label?: string;
  sentAt?: number;
  acceptedAt?: number;
  createdAt?: number;
  snapshotId?: string;
  snapshotReason?: "CONFIRMED" | "COMPLETED" | "UNLOCK" | "QUOTE_SENT" | "VERSION_SAVED" | "PRE_PROMOTE";
  hasSnapshot: boolean;
  total: number | null;
}

interface ProjectVersionContextValue {
  projectId: string;
  versions: ProjectVersionListItem[];
  isLoadingVersions: boolean;
  liveRevision: number | null;
  /** Parsed from `?v=`; null when absent or malformed. */
  viewingRevision: number | null;
  /** True only when `viewingRevision` is a real, non-live revision. */
  isViewingVersion: boolean;
  viewingVersion: ProjectVersionListItem | null;
  /** Null while loading, while not viewing a version, or when the viewed
   *  revision has no captured state (pre-versioning — see `hasCapturedState`). */
  projected: ProjectedView | null;
  isLoadingProjection: boolean;
  /** False exactly when `isViewingVersion` is true but the target revision has
   *  no snapshot — the design doc's "no captured state (pre-versioning)" case,
   *  never rendered as an error page. */
  hasCapturedState: boolean;
  /** Updates `?v=` (preserving `?tab=` and any other params); null clears it. */
  setViewingRevision: (revision: number | null) => void;
}

const ProjectVersionContext = createContext<ProjectVersionContextValue | null>(null);

export function ProjectVersionProvider({
  projectId,
  orgId,
  now,
  children,
}: {
  projectId: string;
  orgId: string | undefined;
  now?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const versionsRaw = useAuthedQuery(
    api.projectVersionsRead.listVersions,
    orgId ? { projectId, orgId, now } : "skip",
  );
  const versions = useMemo<ProjectVersionListItem[]>(() => versionsRaw ?? [], [versionsRaw]);
  const isLoadingVersions = orgId != null && versionsRaw === undefined;
  const liveRevision = useMemo(() => versions.find((v) => v.isLive)?.revision ?? null, [versions]);

  const requestedParam = searchParams.get("v");
  const requestedRevision = requestedParam != null && /^\d+$/.test(requestedParam) ? Number(requestedParam) : null;
  const viewingVersion = useMemo(
    () => (requestedRevision != null ? (versions.find((v) => v.revision === requestedRevision) ?? null) : null),
    [versions, requestedRevision],
  );
  // Only "viewing a version" once the version list has actually loaded and
  // confirmed the requested revision isn't the live one — avoids a flash of
  // read-only chrome for the live revision while `versions` is still loading.
  const isViewingVersion =
    requestedRevision != null && !isLoadingVersions && liveRevision != null && requestedRevision !== liveRevision;
  const hasCapturedState = !isViewingVersion || (viewingVersion?.hasSnapshot ?? false);

  const snapshotId = isViewingVersion ? viewingVersion?.snapshotId : undefined;
  const entriesRaw = useAuthedQuery(
    api.projectLocksRead.snapshotEntries,
    orgId && snapshotId ? { snapshotId, orgId } : "skip",
  );
  const isLoadingProjection = isViewingVersion && hasCapturedState && entriesRaw === undefined;
  const projected = useMemo<ProjectedView | null>(() => {
    if (!isViewingVersion || !hasCapturedState || !entriesRaw) return null;
    return projectSnapshotEntries(entriesRaw as SnapshotEntryLike[]);
  }, [isViewingVersion, hasCapturedState, entriesRaw]);

  const setViewingRevision = useCallback(
    (revision: number | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (revision == null) params.delete("v");
      else params.set("v", String(revision));
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const value: ProjectVersionContextValue = {
    projectId,
    versions,
    isLoadingVersions,
    liveRevision,
    viewingRevision: requestedRevision,
    isViewingVersion,
    viewingVersion,
    projected,
    isLoadingProjection,
    hasCapturedState,
    setViewingRevision,
  };

  return <ProjectVersionContext.Provider value={value}>{children}</ProjectVersionContext.Provider>;
}

/** Throws outside a `ProjectVersionProvider` — every project-detail tab is
 *  meant to be mounted under one (page.tsx), so a missing provider is a bug,
 *  not a state to handle gracefully. */
export function useProjectVersion(): ProjectVersionContextValue {
  const ctx = useContext(ProjectVersionContext);
  if (!ctx) throw new Error("useProjectVersion must be used within a ProjectVersionProvider");
  return ctx;
}
