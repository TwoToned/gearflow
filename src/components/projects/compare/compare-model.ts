import { formatCurrency } from "@/lib/formatters";
import type { ColorIntent } from "@/lib/status-colors";
import type { CompareSide, ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * The Compare sheet's pure parts (Project Versioning v2 Phase 5b, #1232;
 * re-hosted as a sheet by UX Phase 8, D20). Everything here READS the output of
 * `versionsRead.compareVersions` (the alignment and bridge math live in
 * `convex/lib/versionCompare.ts`); nothing re-derives a diff (R-3.1).
 */

export type RowSnapshot = {
  id: string;
  label: string;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number;
  status?: string;
};

export type CompareRow = {
  key: string;
  kind: "line" | "group" | "service";
  state: "unchanged" | "changed" | "added" | "removed" | "moved";
  categoryLabel?: string;
  movedFromCategoryLabel?: string;
  alsoRepriced?: boolean;
  a: RowSnapshot | null;
  b: RowSnapshot | null;
};

export type BridgeSegment = { key: string; state: string; label: string; detail?: string; amount: number; rowKeys: string[] };

export type CompareData = {
  a: { label: string; totals: { total: number } };
  b: { label: string; totals: { total: number } };
  rows: CompareRow[] | null;
  bridge: { totalA: number; totalB: number; segments: BridgeSegment[] };
  planFieldChanges: { field: string }[] | null;
};

/** A ghost row: the placeholder D50 requires at a moved row's OLD category/group. */
export type Ghost = { ghost: true; key: string; text: string };
export type CompareGroup = { label: string; rows: (CompareRow | Ghost)[] };

export const STATE_INTENT: Record<string, ColorIntent> = {
  added: "success",
  removed: "error",
  changed: "warning",
  moved: "info",
  planField: "info",
  snapshotOnly: "neutral",
  unexplained: "error",
};

export function stateBadgeLabel(state: string): string {
  switch (state) {
    case "added": return "Added";
    case "removed": return "Removed";
    case "changed": return "Repriced";
    case "moved": return "Moved";
    default: return state;
  }
}

export function money(n: number): string {
  return formatCurrency(n);
}

export function signedMoney(n: number): string {
  return `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
}

export function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function shortLabel(label: string): string {
  return label.split(" ·")[0];
}

type CompareQueryArg = { kind: "version"; versionId: string } | { kind: "quoteSnapshot"; quoteId: string };

/** Resolves a `CompareSide` (a version NUMBER, live, or a quote snapshot) into
 *  the query's own arg shape. `null` while the referenced version can't be
 *  resolved (still loading, or stale after the list changed): the caller skips
 *  the query rather than sending a bad id. */
export function resolveSideArg(
  side: CompareSide,
  versions: ProjectVersionSummary[],
  liveVersion: ProjectVersionSummary | null,
): CompareQueryArg | null {
  if (side.kind === "quoteSnapshot") return { kind: "quoteSnapshot", quoteId: side.quoteId };
  const target = side.number == null ? liveVersion : (versions.find((v) => v.number === side.number) ?? null);
  return target ? { kind: "version", versionId: target.id } : null;
}

export function compareQueryArgs(orgId: string, projectId: string, argA: CompareQueryArg | null, argB: CompareQueryArg | null) {
  if (!argA || !argB) return "skip" as const;
  return { organizationId: orgId, projectId, a: argA, b: argB };
}

export function sideDisplayLabel(side: CompareSide, versions: ProjectVersionSummary[], liveVersion: ProjectVersionSummary | null): string {
  if (side.kind === "quoteSnapshot") return side.label;
  const target = side.number == null ? liveVersion : versions.find((v) => v.number === side.number);
  if (!target) return "…";
  return `v${target.number}${target.isLive ? " · Live" : ""}${target.label ? ` · ${target.label}` : ""}`;
}

function ghostFor(row: CompareRow): Ghost {
  return {
    ghost: true,
    key: `${row.key}:ghost`,
    text: `${row.b?.label ?? row.a?.label ?? "This line"} moved to ${row.categoryLabel ?? "another category"} — counted there, not here`,
  };
}

/** Groups rows by category label for display (D49/D50), including ghost
 *  placeholders at a moved row's OLD category, ALWAYS shown (even in "Only
 *  changes" mode), since a moved row IS a change. */
export function buildCompareGroups(allRows: CompareRow[], viewMode: "all" | "changes"): CompareGroup[] {
  const visible = allRows.filter((r) => viewMode === "all" || r.state !== "unchanged");
  const byLabel = new Map<string, (CompareRow | Ghost)[]>();
  const order: string[] = [];
  function bucket(label: string) {
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    return byLabel.get(label)!;
  }
  for (const r of visible) bucket(r.categoryLabel ?? "Uncategorized").push(r);
  for (const r of allRows) {
    if (r.state === "moved" && r.movedFromCategoryLabel && r.movedFromCategoryLabel !== r.categoryLabel) {
      bucket(r.movedFromCategoryLabel).push(ghostFor(r));
    }
  }
  return order.map((label) => ({ label, rows: byLabel.get(label)! }));
}

/** `1` to step forward (`n`), `-1` back (`p`), `null` for any other key. */
export function stepDirectionForKey(key: string): 1 | -1 | null {
  const lower = key.toLowerCase();
  if (lower === "n") return 1;
  if (lower === "p") return -1;
  return null;
}
