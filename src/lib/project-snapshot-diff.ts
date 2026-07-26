/**
 * Pure diff logic for the #792 Versions/compare UI — snapshot↔current or
 * snapshot↔snapshot. Kept framework-free so it's unit-testable without
 * rendering the panel. "Current" is passed in the SAME entry shape as a
 * snapshot's entries (entityType/entityId/data) so both comparisons share
 * one code path.
 */

export type SnapshotEntityType = "project" | "category" | "group" | "lineItem" | "service" | "crewAssignment";

export interface SnapshotEntryLike {
  entityType: SnapshotEntityType;
  entityId: string;
  data: Record<string, unknown>;
}

export type DiffStatus = "added" | "removed" | "changed";

export interface DiffRow {
  entityType: SnapshotEntityType;
  entityId: string;
  status: DiffStatus;
  label: string;
  beforePrice: number | null;
  afterPrice: number | null;
}

/** The one price-bearing field per entity type used for the row's before/after
 *  display (mirrors the #791 locked-field tables — the fields that actually
 *  move the project's totals). */
function priceField(entityType: SnapshotEntityType): string | null {
  switch (entityType) {
    case "group": return "price";
    case "lineItem": return "unitPrice";
    case "service": return "costTotal";
    default: return null;
  }
}

function label(entityType: SnapshotEntityType, data: Record<string, unknown>): string {
  const name =
    (data.title as string | undefined) ??
    (data.description as string | undefined) ??
    (data.name as string | undefined) ??
    (data.crewMemberId as string | undefined);
  return name || entityType;
}

/** True when the two entries' comparison-relevant fields differ. Ignores
 *  bookkeeping fields (_id/_creationTime already stripped at capture,
 *  updatedAt/createdAt aren't meaningful to a human diff). */
function hasChanged(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updatedAt");
  keys.delete("createdAt");
  for (const k of keys) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return true;
  }
  return false;
}

/** Diff `before` against `after` (both entry lists in the same shape). Only
 *  categories/groups/lineItems/services/crewAssignments participate — the
 *  single "project" entry is surfaced separately (financial totals delta). */
export function diffSnapshotEntries(before: SnapshotEntryLike[], after: SnapshotEntryLike[]): DiffRow[] {
  const beforeMap = new Map(before.filter((e) => e.entityType !== "project").map((e) => [`${e.entityType}:${e.entityId}`, e]));
  const afterMap = new Map(after.filter((e) => e.entityType !== "project").map((e) => [`${e.entityType}:${e.entityId}`, e]));
  const rows: DiffRow[] = [];

  for (const [key, entry] of afterMap) {
    const prior = beforeMap.get(key);
    const field = priceField(entry.entityType);
    const afterPrice = field ? Number(entry.data[field] ?? 0) : null;
    if (!prior) {
      rows.push({ entityType: entry.entityType, entityId: entry.entityId, status: "added", label: label(entry.entityType, entry.data), beforePrice: null, afterPrice });
      continue;
    }
    if (hasChanged(prior.data, entry.data)) {
      const beforePrice = field ? Number(prior.data[field] ?? 0) : null;
      rows.push({ entityType: entry.entityType, entityId: entry.entityId, status: "changed", label: label(entry.entityType, entry.data), beforePrice, afterPrice });
    }
  }
  for (const [key, entry] of beforeMap) {
    if (!afterMap.has(key)) {
      const field = priceField(entry.entityType);
      const beforePrice = field ? Number(entry.data[field] ?? 0) : null;
      rows.push({ entityType: entry.entityType, entityId: entry.entityId, status: "removed", label: label(entry.entityType, entry.data), beforePrice, afterPrice: null });
    }
  }

  return rows;
}

export interface FinancialTotals {
  subtotal: number;
  total: number;
  margin: number;
}

export function projectTotalsFromEntry(entry: SnapshotEntryLike | undefined): FinancialTotals | null {
  if (!entry || entry.entityType !== "project") return null;
  return {
    subtotal: Number(entry.data.subtotal ?? 0),
    total: Number(entry.data.total ?? 0),
    margin: Number(entry.data.margin ?? 0),
  };
}
