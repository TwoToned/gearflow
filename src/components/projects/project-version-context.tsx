"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the version-
 * switching seam, rebuilt on the REAL `projectVersions` table
 * (`convex/versions.ts`/`convex/versionsRead.ts`, Phase 1-3) instead of the
 * older `projects.revision`/`liveRevision` + `projectSnapshots` JSON-blob
 * program (FEATUREDOCS/70). Which version is being VIEWED is still a
 * per-user URL param (`?v=<number>`), never a database field (design §3.1)
 * — two people can view different versions of the same project at once and
 * neither affects the other or the live data.
 *
 * Mounted once above the tabs (`ProjectDetailPage`); every consumer that
 * needs to know "which version, and is it live" reads `useProjectVersion()`
 * rather than re-deriving it. The header pill (`version-switcher.tsx`), the
 * Versions panel (`versions-panel.tsx`), `VersionStrip` and the Equipment
 * tab's warehouse-verb greying all share this one context/one query — the
 * "one control to switch, one place to manage" principle (§5.1) starts here:
 * a single `versionsRead.listForProject` subscription, not the four
 * overlapping reads the old lock-strip/read-only-bar/drift-indicator/
 * switcher combination used.
 */

export interface ProjectVersionSummary {
  id: string;
  number: number;
  label?: string;
  isLive: boolean;
  contentState: "ready" | "missing";
  createdAt: number;
  createdById: string;
  basedOnVersionId?: string;
}

/**
 * #1232 (Phase 5b, parent #1221, design §5.1 D46-D53) — one side of a
 * Compare. `number: null` means "the live version" (mirrors `viewingNumber`'s
 * own null-means-live convention). `quoteSnapshot` is the drift entry point
 * (`VersionStrip`'s "Quote total has moved..." line, D53) — a sent quote's
 * frozen totals, never a live `projectVersions` row.
 */
export type CompareSide =
  | { kind: "version"; number: number | null }
  | { kind: "quoteSnapshot"; quoteId: string; label: string };

export interface CompareModeState {
  a: CompareSide;
  b: CompareSide;
}

export interface ProjectVersionContextValue {
  projectId: string;
  orgId: string | undefined;
  versions: ProjectVersionSummary[];
  isLoadingVersions: boolean;
  liveVersion: ProjectVersionSummary | null;
  /** Parsed from `?v=`; null when absent, malformed, or the live version's
   *  own number (viewing live is "no param", never "the live number"). */
  viewingNumber: number | null;
  /** True only once `versions` has loaded and `viewingNumber` resolves to a
   *  real, non-live version — avoids a flash of "viewing" chrome while the
   *  list is still loading. */
  isViewingVersion: boolean;
  viewingVersion: ProjectVersionSummary | null;
  /** The viewed version's PLAN FIELDS bag (`convex/versionsRead.ts`'s
   *  `getVersion`) — feeds `composeProjectWithVersion`. `null` while loading
   *  or whenever `isViewingVersion` is false. */
  viewingPlanFields: Record<string, unknown> | null;
  isLoadingViewingVersion: boolean;
  /** #1233 (Phase 6) — the viewed version's DRIFT signal against its own
   *  sent quote (`convex/versionsRead.ts`'s `quoteDriftForVersion`): null
   *  while loading, while not viewing a non-live version, or when that
   *  version has never had a quote sent. Feeds `VersionStrip`'s drift line. */
  viewingQuoteDrift: {
    quoteId: string;
    quoteLabel: string;
    quoteStatus: string;
    sentTotal: number;
    currentTotal: number;
    driftAmount: number;
  } | null;
  /** Updates `?v=` (preserving every other param); `null` switches back to live. */
  setViewingNumber: (number: number | null) => void;
  /** #1232 — Compare mode is a MODE on this page, not a route (D46/D47): a
   *  page-level toggle, not `?v=`-driven, so it never fights the browser
   *  back button against ordinary version switching. `null` = compare is
   *  off. Opened by the switcher's "Compare" menu item and by
   *  `VersionStrip`'s drift line (D53). */
  compare: CompareModeState | null;
  openCompare: (a: CompareSide, b: CompareSide) => void;
  closeCompare: () => void;
}

const ProjectVersionContext = createContext<ProjectVersionContextValue | null>(null);

/** Digits only; anything else (a typo, a stray `?v=abc`) reads as "no
 *  version requested" rather than a parse error. */
function parseRequestedNumber(param: string | null): number | null {
  if (param == null || !/^\d+$/.test(param)) return null;
  return Number(param);
}

function versionsQueryArgs(orgId: string | undefined, projectId: string) {
  return orgId ? { organizationId: orgId, projectId } : ("skip" as const);
}

function versionQueryArgs(
  orgId: string | undefined,
  projectId: string,
  fetch: boolean,
  versionId: string | undefined,
) {
  return orgId && fetch && versionId ? { organizationId: orgId, projectId, versionId } : ("skip" as const);
}

/**
 * The state computation itself, as a standalone hook — split out of
 * `ProjectVersionProvider` so `ProjectDetailPage` can call it directly,
 * BEFORE the provider's own JSX, and derive the "composed object" (design
 * §5 D32, `composeProjectWithVersion`) from its `viewingPlanFields` for the
 * rest of the page to read. The provider below just re-exposes this same
 * value over context so deeper components (the header pill, `VersionStrip`,
 * tab slots) don't need it threaded through props.
 */
export function useProjectVersionState(projectId: string, orgId: string | undefined): ProjectVersionContextValue {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const versionsRaw = useAuthedQuery(api.versionsRead.listForProject, versionsQueryArgs(orgId, projectId));
  const versions = useMemo<ProjectVersionSummary[]>(() => versionsRaw ?? [], [versionsRaw]);
  const isLoadingVersions = orgId != null && versionsRaw === undefined;

  const requestedNumber = parseRequestedNumber(searchParams.get("v"));
  const liveVersion = useMemo(() => versions.find((v) => v.isLive) ?? null, [versions]);
  const requestedVersion = useMemo(
    () => (requestedNumber == null ? null : (versions.find((v) => v.number === requestedNumber) ?? null)),
    [versions, requestedNumber],
  );
  // Only "viewing a version" once the list has loaded AND the requested
  // number resolves to a real, non-live row — a stray/typo'd `?v=` or a
  // number that doesn't (yet) exist reads as "viewing live", never a crash.
  const isViewingVersion = !isLoadingVersions && requestedVersion != null && !requestedVersion.isLive;
  const viewingVersion = isViewingVersion ? requestedVersion : null;

  const fetchViewing = isViewingVersion;
  const viewingRaw = useAuthedQuery(
    api.versionsRead.getVersion,
    versionQueryArgs(orgId, projectId, fetchViewing, viewingVersion?.id),
  );
  const isLoadingViewingVersion = fetchViewing && viewingRaw === undefined;
  const viewingPlanFields = useMemo<Record<string, unknown> | null>(() => {
    if (!fetchViewing || !viewingRaw) return null;
    return (viewingRaw.planFields as Record<string, unknown>) ?? null;
  }, [fetchViewing, viewingRaw]);

  // #1233 (Phase 6) — same gating as the plan-fields fetch above: only while
  // actually viewing a non-live version. `now` is omitted (the query
  // defaults to its own `Date.now()`) rather than passed from the client, so
  // this doesn't re-subscribe with a new arg on every render.
  const driftRaw = useAuthedQuery(
    api.versionsRead.quoteDriftForVersion,
    versionQueryArgs(orgId, projectId, fetchViewing, viewingVersion?.id),
  );
  const viewingQuoteDrift = fetchViewing ? (driftRaw ?? null) : null;

  const setViewingNumber = useCallback(
    (number: number | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (number == null) params.delete("v");
      else params.set("v", String(number));
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const [compare, setCompare] = useState<CompareModeState | null>(null);
  const openCompare = useCallback((a: CompareSide, b: CompareSide) => setCompare({ a, b }), []);
  const closeCompare = useCallback(() => setCompare(null), []);

  return {
    projectId,
    orgId,
    versions,
    isLoadingVersions,
    liveVersion,
    viewingNumber: requestedNumber,
    isViewingVersion,
    viewingVersion,
    viewingPlanFields,
    isLoadingViewingVersion,
    viewingQuoteDrift,
    setViewingNumber,
    compare,
    openCompare,
    closeCompare,
  };
}

/** Thin context wrapper — `value` is `useProjectVersionState`'s own return,
 *  computed by the caller (page.tsx) so it can also build the composed
 *  object before this provider's children render. */
export function ProjectVersionProvider({
  value,
  children,
}: {
  value: ProjectVersionContextValue;
  children: React.ReactNode;
}) {
  return <ProjectVersionContext.Provider value={value}>{children}</ProjectVersionContext.Provider>;
}

/** Throws outside a `ProjectVersionProvider` — every project-detail surface
 *  that needs version state is mounted under one (page.tsx), so a missing
 *  provider is a bug, not a state to handle gracefully. */
export function useProjectVersion(): ProjectVersionContextValue {
  const ctx = useContext(ProjectVersionContext);
  if (!ctx) throw new Error("useProjectVersion must be used within a ProjectVersionProvider");
  return ctx;
}
