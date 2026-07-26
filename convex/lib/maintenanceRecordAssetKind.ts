import type { Doc } from "../_generated/dataModel";

/**
 * `maintenanceRecordAssets` is polymorphic (WS6 #945 — see the schema.ts
 * comment on the table): a row is either a "LINK" (the original hold/release
 * asset-link meaning maintenanceWrites.ts owns) or a "CHECKOFF" (a recurring-PM
 * progress row the check-off mutations own). `kind` is absent on every
 * pre-existing row, which MUST keep reading as "LINK" (zero-migration
 * back-compat) — every site that reads this table filters through one of these
 * two predicates rather than re-deriving the default inline, so the two row
 * kinds can never bleed into each other's logic (R-3.1).
 */
type Kindable = Pick<Doc<"maintenanceRecordAssets">, "kind">;

export function isLinkRow(row: Kindable): boolean {
  return (row.kind ?? "LINK") === "LINK";
}

export function isCheckoffRow(row: Kindable): boolean {
  return row.kind === "CHECKOFF";
}

/**
 * Sum of WS6 recurring-PM progress recorded by a set of CHECKOFF rows — a
 * serialised unit counts once (by distinct assetId, so a duplicate/retried
 * row never double-counts); a bulk session's `quantity` sums. Deliberately
 * generic over both shapes (one maintenanceRecords cycle is one model, which
 * is either SERIALIZED or BULK, never both) rather than requiring a model
 * lookup to pick a formula. Single source of truth — shared by the check-off
 * writes (maintenanceCheckoffWrites.ts, to decide auto-completion) and the
 * worklist read (maintenanceScheduleWorklist.ts, to display "N of M").
 */
export function computeCheckoffProgress(rows: { assetId?: string; quantity?: number }[]): number {
  const bulkQty = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  const serializedCount = new Set(rows.filter((r) => r.assetId != null).map((r) => r.assetId)).size;
  return bulkQty + serializedCount;
}
