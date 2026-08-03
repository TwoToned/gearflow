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
  /** The stored document artifact (#987) — absent on a DRAFT or a sent
   *  revision whose render failed. Empty `quoteId` (the never-quoted
   *  synthetic entry) never has one. */
  pdfFileId?: string;
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
  /** #1080/#1101 — the Equipment tab's bundle-assembly read
   *  (`convex/projectVersionsEquipment.ts`), shaped like the LIVE
   *  `equipmentTab.bundle` so `VersionProjectedEquipment` can run it through
   *  the SAME `reconstructProjectCategories`/`reconstructUncategorized*`
   *  functions the live tab uses (R-3.1) — sub-hire groups and the
   *  `categorySlots` combined order included. `null` while loading, while not
   *  viewing a captured version, or if the snapshot row itself can't be
   *  resolved. An OLDER (pre-#1101) snapshot still resolves — it just has
   *  empty sub-hire/categorySlot arrays, degrading gracefully to "groups then
   *  standalone items" ordering with no sub-hire block, never an error. */
  equipmentBundle: unknown;
  isLoadingEquipmentBundle: boolean;
  /** Updates `?v=` (preserving `?tab=` and any other params); null clears it. */
  setViewingRevision: (revision: number | null) => void;
}

const ProjectVersionContext = createContext<ProjectVersionContextValue | null>(null);

/** Digits only; anything else (a typo, a stray `?v=abc`) reads as "no version
 *  requested" rather than a parse error. */
function parseRequestedRevision(param: string | null): number | null {
  if (param == null || !/^\d+$/.test(param)) return null;
  return Number(param);
}

function resolveLiveRevision(versions: ProjectVersionListItem[]): number | null {
  const live = versions.find((v) => v.isLive);
  return live ? live.revision : null;
}

function resolveViewingVersion(
  versions: ProjectVersionListItem[],
  requestedRevision: number | null,
): ProjectVersionListItem | null {
  if (requestedRevision == null) return null;
  return versions.find((v) => v.revision === requestedRevision) ?? null;
}

/** Only "viewing a version" once the list has actually loaded and confirmed
 *  the requested revision isn't the live one — avoids a flash of read-only
 *  chrome for the live revision while `versions` is still loading. */
function resolveIsViewingVersion(
  requestedRevision: number | null,
  isLoadingVersions: boolean,
  liveRevision: number | null,
): boolean {
  if (requestedRevision == null || isLoadingVersions || liveRevision == null) return false;
  return requestedRevision !== liveRevision;
}

/** The design doc's "no captured state (pre-versioning)" case — true unless
 *  actively viewing a version whose target revision has no snapshot. */
function resolveHasCapturedState(isViewingVersion: boolean, viewingVersion: ProjectVersionListItem | null): boolean {
  if (!isViewingVersion) return true;
  return viewingVersion != null && viewingVersion.hasSnapshot;
}

/** Shared gate for BOTH captured-version reads (`snapshotEntries` and the
 *  equipment bundle) — split out purely to keep `ProjectVersionProvider`'s
 *  own branch count under R-3.6's ceiling; both reads are only meaningful
 *  while actively viewing a version that has something captured. */
function shouldFetchCapturedVersion(isViewingVersion: boolean, hasCapturedState: boolean): boolean {
  return isViewingVersion && hasCapturedState;
}

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

  const requestedRevision = parseRequestedRevision(searchParams.get("v"));
  const liveRevision = useMemo(() => resolveLiveRevision(versions), [versions]);
  const viewingVersion = useMemo(
    () => resolveViewingVersion(versions, requestedRevision),
    [versions, requestedRevision],
  );
  const isViewingVersion = resolveIsViewingVersion(requestedRevision, isLoadingVersions, liveRevision);
  const hasCapturedState = resolveHasCapturedState(isViewingVersion, viewingVersion);

  const snapshotId = isViewingVersion ? viewingVersion?.snapshotId : undefined;
  const fetchCaptured = shouldFetchCapturedVersion(isViewingVersion, hasCapturedState);
  const entriesRaw = useAuthedQuery(
    api.projectLocksRead.snapshotEntries,
    orgId && snapshotId ? { snapshotId, orgId } : "skip",
  );
  const isLoadingProjection = fetchCaptured && entriesRaw === undefined;
  const projected = useMemo<ProjectedView | null>(() => {
    if (!fetchCaptured || !entriesRaw) return null;
    return projectSnapshotEntries(entriesRaw as SnapshotEntryLike[]);
  }, [fetchCaptured, entriesRaw]);

  // #1080/#1101 — a second, join-shaped read for the Equipment tab
  // specifically (sub-hires/categorySlots/reference-data resolution the pure
  // projectSnapshotEntries mapper can't do). Gated the same way as
  // `entriesRaw` above.
  const equipmentBundleRaw = useAuthedQuery(
    api.projectVersionsEquipment.bundle,
    orgId && fetchCaptured && snapshotId ? { projectId, orgId, snapshotId } : "skip",
  );
  const isLoadingEquipmentBundle = fetchCaptured && equipmentBundleRaw === undefined;
  const equipmentBundle = fetchCaptured ? (equipmentBundleRaw ?? null) : null;

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
    equipmentBundle,
    isLoadingEquipmentBundle,
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
