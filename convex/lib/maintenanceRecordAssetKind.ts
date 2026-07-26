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
