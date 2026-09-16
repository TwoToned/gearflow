import type { Doc } from "../_generated/dataModel";

/**
 * Project Versioning v2, Phase 3 (#1229, parent #1221) — the PLAN FIELDS
 * shared 1:1 by `projects` and `projectVersions` (see `projectVersions`'
 * own schema.ts comment: "mirrors the shape/types of the matching field on
 * `projects` 1:1"). ONE list (R-3.1): `versions.createNative` reads from it
 * to snapshot a fresh version's plan, and `versions.makeLiveNative`'s
 * pointer-flip swap reads AND writes through it in both directions — so the
 * two can never drift on what fields make up "a version's plan".
 *
 * Deliberately excludes every MONEY/derived field (`subtotal`, `total`,
 * `taxAmount`, `margin`, …) — those are recalc-owned outputs
 * (`convex/lib/recalc.ts`), never part of a version's plan snapshot, exactly
 * the same reasoning `projectVersions` itself documents for carrying no
 * totals columns at all.
 */
export const PLAN_FIELDS = [
  "rentalStartDate",
  "rentalEndDate",
  "projectStartDate",
  "projectStartTime",
  "projectEndDate",
  "projectEndTime",
  "loadInDate",
  "loadInTime",
  "eventStartDate",
  "eventStartTime",
  "eventEndDate",
  "eventEndTime",
  "loadOutDate",
  "loadOutTime",
  "billingWeeksOverride",
  "billingDaysOverride",
  "taxRate",
  "discountPercent",
  "discountAmount",
  "depositPercent",
  "clientId",
  "clientContactId",
  "locationId",
  "siteContactName",
  "siteContactPhone",
  "siteContactEmail",
  "type",
  "description",
  "crewNotes",
  "internalNotes",
  "clientNotes",
] as const;

export type PlanFieldName = (typeof PLAN_FIELDS)[number];
export type PlanFieldSet = { [K in PlanFieldName]?: Doc<"projects">[K] };

/**
 * Picks just the plan fields off a `projects` or `projectVersions` doc (the
 * two shapes agree on every one of these field names/types). Every key is
 * always present in the result, even when absent on `source` (as an explicit
 * `undefined`) — patching that object back onto the OTHER side CLEARS a
 * field the source doesn't have, rather than leaving whatever stale value
 * was there before. This is this codebase's standing `ctx.db.patch`
 * convention for "clear a field" (e.g. `quotesWrites.ts` clearing
 * `pdfFileId`/`recalledAt` on recall) — without it, a make-live pointer
 * flip could leak the OUTGOING version's plan bits into the new live
 * project row wherever the INCOMING version left a field unset.
 */
export function pickPlanFields(source: Partial<Record<PlanFieldName, unknown>>): PlanFieldSet {
  const out: Record<string, unknown> = {};
  for (const key of PLAN_FIELDS) out[key] = source[key];
  return out as PlanFieldSet;
}
