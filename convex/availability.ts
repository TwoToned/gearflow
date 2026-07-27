import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgRead } from "./lib/auth";
import {
  buildModelBookings,
  buildKitBookings,
  buildAssetBookings,
  projectMatchesCalendarWindow,
  countLineItemsByProject,
  type BookingLineItem,
  type BookingUnit,
  type BookingProject,
  type BookingRow,
  type DateWindowMs,
} from "./lib/availabilityBookings";
import type { Doc } from "./_generated/dataModel";

/**
 * Equipment availability / bookings — browser-native replacement for the deleted
 * `src/server/availability.ts` server action. Each query is org-scoped
 * (`requireOrgRead`) and fetches by a SCOPED index (`by_modelId` / `by_kitId` /
 * `by_assetId`) rather than collecting the whole org, then re-checks
 * `organizationId` on every global-index row (defense-in-depth: those indexes are
 * global). The pure join/window math lives in `./lib/availabilityBookings` (a
 * byte-for-byte port of the old pure builders, pinned by
 * `availabilityBookings.test.ts`).
 *
 * These are ONE-SHOT reads from the browser (a calendar popover with no liveness
 * need — the consumer uses `useServerQuery`), so an org-wide `by_organizationId`
 * project scan in `calendarData` is acceptable; the per-entity booking reads are
 * index-scoped and cheap.
 */

// ─── shapes ──────────────────────────────────────────────────────────────────

const bookingEntryValidator = v.object({
  id: v.string(),
  projectId: v.string(),
  projectNumber: v.string(),
  projectName: v.string(),
  clientName: v.union(v.string(), v.null()),
  projectStatus: v.string(),
  rentalStartDate: v.string(),
  rentalEndDate: v.string(),
  quantity: v.number(),
});

const calendarProjectValidator = v.object({
  id: v.string(),
  projectNumber: v.string(),
  name: v.string(),
  clientName: v.union(v.string(), v.null()),
  status: v.string(),
  rentalStartDate: v.string(),
  rentalEndDate: v.string(),
  lineItemCount: v.number(),
});

// ─── doc → minimal-shape mappers (only the builder-relevant fields) ──────────

function toBookingLineItem(d: Doc<"projectLineItems">): BookingLineItem {
  return {
    id: d.id,
    projectId: d.projectId,
    modelId: d.modelId ?? null,
    kitId: d.kitId ?? null,
    assetId: d.assetId ?? null,
    isKitChild: d.isKitChild ?? false,
    status: d.status ?? "QUOTED",
    quantity: d.quantity ?? 1,
  };
}

function toBookingUnit(d: Doc<"projectLineItemUnits">): BookingUnit {
  return {
    lineItemId: d.lineItemId,
    assetId: d.assetId ?? null,
    status: d.status ?? "QUOTED",
  };
}

function toBookingProject(d: Doc<"projects">): BookingProject {
  return {
    id: d.id,
    projectNumber: d.projectNumber,
    name: d.name,
    clientId: d.clientId ?? null,
    status: d.status ?? "ENQUIRY",
    isTemplate: d.isTemplate ?? false,
    rentalStartMs: d.rentalStartDate ?? null,
    rentalEndMs: d.rentalEndDate ?? null,
    projectStartMs: d.projectStartDate ?? null,
    projectEndMs: d.projectEndDate ?? null,
  };
}

/** epoch-ms → ISO string (matching the old `.toISOString()`); null → "". */
function msToIso(ms: number | null): string {
  return ms == null ? "" : new Date(ms).toISOString();
}

// ─── shared helpers ──────────────────────────────────────────────────────────

/**
 * Fetch every in-org project referenced by `lineItems` into a `projectId → project`
 * map. `by_cuid` is a GLOBAL index → drop any row whose `organizationId !== orgId`.
 */
async function loadProjectsForLines(
  ctx: QueryCtx,
  orgId: string,
  lineItems: BookingLineItem[],
): Promise<Map<string, BookingProject>> {
  const projectIds = [...new Set(lineItems.map((li) => li.projectId))];
  const projectsById = new Map<string, BookingProject>();
  await Promise.all(
    projectIds.map(async (pid) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique();
      if (p && p.organizationId === orgId) projectsById.set(pid, toBookingProject(p));
    }),
  );
  return projectsById;
}

/** Resolve `clientName` onto booking rows, producing the public BookingEntry shape. */
async function rowsToEntries(
  ctx: QueryCtx,
  orgId: string,
  rows: BookingRow[],
) {
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((c): c is string => c != null))];
  const nameById = new Map<string, string>();
  await Promise.all(
    clientIds.map(async (cid) => {
      const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", cid)).unique();
      if (c && c.organizationId === orgId) nameById.set(cid, c.name);
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    projectName: r.projectName,
    clientName: r.clientId != null ? nameById.get(r.clientId) ?? null : null,
    projectStatus: r.projectStatus,
    rentalStartDate: msToIso(r.rentalStartMs),
    rentalEndDate: msToIso(r.rentalEndMs),
    quantity: r.quantity,
  }));
}

// ─── queries ─────────────────────────────────────────────────────────────────

/**
 * Bookings for a model within a window, plus the model's stock breakdown. Lines
 * are fetched by the scoped `by_modelId` index (org re-checked).
 */
export const modelBookings = query({
  args: { orgId: v.string(), modelId: v.string(), startMs: v.number(), endMs: v.number() },
  returns: v.object({
    bookings: v.array(bookingEntryValidator),
    totalStock: v.number(),
    effectiveStock: v.number(),
  }),
  handler: async (ctx, { orgId, modelId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    const window: DateWindowMs = { startMs, endMs };

    const lineDocs = (
      await ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect()
    ).filter((d) => d.organizationId === orgId);
    const lineItems = lineDocs.map(toBookingLineItem);
    const projectsById = await loadProjectsForLines(ctx, orgId, lineItems);
    const rows = buildModelBookings(modelId, lineItems, projectsById, window);
    const bookings = await rowsToEntries(ctx, orgId, rows);

    // Stock breakdown — active assets/bulk-assets by the scoped by_modelId index
    // (org re-checked; isActive !== false, matching getActive*ByModel).
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique();
    let totalStock = 0;
    let effectiveStock = 0;
    if (model && model.organizationId === orgId) {
      const activeAssets = (
        await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect()
      ).filter((a) => a.organizationId === orgId && a.isActive !== false);
      const activeBulk = (
        await ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect()
      ).filter((b) => b.organizationId === orgId && b.isActive !== false);

      const assetType =
        model.assetType === "BULK" || model.assetType === "SERIALIZED"
          ? model.assetType
          : activeBulk.length > 0
            ? "BULK"
            : "SERIALIZED";

      if (assetType === "SERIALIZED") {
        totalStock = activeAssets.length;
        const unavailable = activeAssets.filter(
          // WS11 (#950) — a sold unit is terminal/disposed, same as RETIRED/LOST.
          (a) => a.status === "IN_MAINTENANCE" || a.status === "LOST" || a.status === "RETIRED" || a.status === "SOLD",
        ).length;
        effectiveStock = totalStock - unavailable;
      } else {
        totalStock = activeBulk.reduce((sum, ba) => sum + (ba.totalQuantity ?? 0), 0);
        effectiveStock = totalStock;
      }
    }

    return { bookings, totalStock, effectiveStock };
  },
});

/**
 * Bookings for a serialized asset within a window. An asset is booked via a legacy
 * `lineItem.assetId` row OR a `projectLineItemUnit.assetId` row (the fulfillment
 * model). Both fetched by scoped `by_assetId` indexes (org re-checked); the units'
 * parent lines are point-read so the builder can validate their status/window.
 */
export const assetBookings = query({
  args: { orgId: v.string(), assetId: v.string(), startMs: v.number(), endMs: v.number() },
  returns: v.array(bookingEntryValidator),
  handler: async (ctx, { orgId, assetId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    const window: DateWindowMs = { startMs, endMs };

    const legacyLineDocs = (
      await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect()
    ).filter((d) => d.organizationId === orgId);

    const unitDocs = (
      await ctx.db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect()
    ).filter((d) => d.organizationId === orgId);

    // The units reference parent line items (qty lines) that aren't in legacyLineDocs.
    // Point-read them (org re-checked) so the builder's liById covers every unit.
    const byId = new Map<string, Doc<"projectLineItems">>();
    for (const d of legacyLineDocs) byId.set(d.id, d);
    await Promise.all(
      [...new Set(unitDocs.map((u) => u.lineItemId))].map(async (lid) => {
        if (byId.has(lid)) return;
        const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lid)).unique();
        if (li && li.organizationId === orgId) byId.set(lid, li);
      }),
    );

    const lineItems = [...byId.values()].map(toBookingLineItem);
    const units = unitDocs.map(toBookingUnit);
    const projectsById = await loadProjectsForLines(ctx, orgId, lineItems);
    const rows = buildAssetBookings(assetId, lineItems, units, projectsById, window);
    return await rowsToEntries(ctx, orgId, rows);
  },
});

/**
 * Bookings for a kit within a window. Lines fetched by the scoped `by_kitId` index
 * (org re-checked); the builder drops kit-child lines.
 */
export const kitBookings = query({
  args: { orgId: v.string(), kitId: v.string(), startMs: v.number(), endMs: v.number() },
  returns: v.array(bookingEntryValidator),
  handler: async (ctx, { orgId, kitId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    const window: DateWindowMs = { startMs, endMs };

    const lineDocs = (
      await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect()
    ).filter((d) => d.organizationId === orgId);
    const lineItems = lineDocs.map(toBookingLineItem);
    const projectsById = await loadProjectsForLines(ctx, orgId, lineItems);
    const rows = buildKitBookings(kitId, lineItems, projectsById, window);
    return await rowsToEntries(ctx, orgId, rows);
  },
});

/**
 * Calendar projects overlapping the window — looser filter than the booking reads
 * (only excludes CANCELLED). Org-scoped project scan + a per-project non-cancelled
 * line-item count (by_projectId, org re-checked).
 */
export const calendarData = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  returns: v.array(calendarProjectValidator),
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    const window: DateWindowMs = { startMs, endMs };

    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment) — see docs/exceptions.md R-8.3.3
      .collect();

    const calendarProjects = allProjects
      .map(toBookingProject)
      .filter((p) => projectMatchesCalendarWindow(p, window))
      .sort((a, b) => (a.rentalStartMs ?? 0) - (b.rentalStartMs ?? 0));

    // Per-project non-cancelled line-item count (parity with the calendar groupBy).
    const countByProject = new Map<string, number>();
    await Promise.all(
      calendarProjects.map(async (p) => {
        // by_projectId is a GLOBAL index → org re-check per row (defense-in-depth,
        // matching clients.detail; the project is already org-scoped above).
        const lines = (
          await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", p.id)).collect()
        )
          .filter((d) => d.organizationId === orgId)
          .map(toBookingLineItem);
        const c = countLineItemsByProject([p.id], lines).get(p.id) ?? 0;
        countByProject.set(p.id, c);
      }),
    );

    // Resolve client names for the in-window projects (point-read, org re-checked).
    const clientIds = [...new Set(calendarProjects.map((p) => p.clientId).filter((c): c is string => c != null))];
    const nameById = new Map<string, string>();
    await Promise.all(
      clientIds.map(async (cid) => {
        const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", cid)).unique();
        if (c && c.organizationId === orgId) nameById.set(cid, c.name);
      }),
    );

    return calendarProjects.map((p) => ({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      clientName: p.clientId != null ? nameById.get(p.clientId) ?? null : null,
      status: p.status ?? "ENQUIRY",
      rentalStartDate: msToIso(p.rentalStartMs),
      rentalEndDate: msToIso(p.rentalEndMs),
      lineItemCount: countByProject.get(p.id) ?? 0,
    }));
  },
});
