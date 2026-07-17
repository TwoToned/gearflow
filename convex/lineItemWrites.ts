import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { assertLineMoneyFields } from "./lib/moneyGuards";
import { roundCurrency, computeLineTotal } from "./lib/lineTotal";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import * as enums from "./lib/validators";
import { expandAccessoryChildLines } from "./lib/fulfillment";
import { createKitLineItemCore, assertProjectInOrg } from "./projectLineItems";
import {
  loadModelAvailabilityBundle,
  computeModelAvailability,
  findAssetConflict,
  findKitConflict,
} from "./lib/availabilityCore";
import { computeGroupSuggestedPrice } from "./lib/suggestedPrice";
import { enqueueWebhookEvent } from "./lib/webhookEnqueue";

/**
 * Native LINE-ITEM write mutations (Phase 5, the money domain — done safely).
 *
 * SCOPE: only the writes whose logic is cleanly separable from the financial
 * orchestration. recalculateProjectTotals stays SERVER-SIDE and runs post-hoc
 * exactly as before (it already runs after the write, never inside the write
 * transaction — src/server/line-items.ts), so the totals math is byte-identical
 * and parity is preserved by construction. addLineItem is NOT here — its
 * cross-project double-booking check reads every overlapping project (Convex
 * read-limit risk in a mutation) + accessory/kit expansion is ~400 lines of
 * orchestration; it stays server-orchestrated for now.
 *
 * removeNative mirrors removeLineItemCascade (convex/projectLineItems.ts) + adds the
 * child-removal guard (kit/accessory children can't be removed directly) + the DELETE
 * audit, all atomic. Gated behind NATIVE_LINEITEM_WRITES.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// ─── Collaboration colour (deterministic from userId) ────────────────────────
// Inlined from src/lib/collaboration-colors.ts getUserColor (same as
// projectGroupsWrites.ts) so the collab events this file writes are byte-identical
// to the ones the server actions emitted via writeCollabActivityEvent.
const COLLAB_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#0891b2", "#059669", "#65a30d",
  "#d97706", "#0d9488", "#4f46e5", "#9333ea", "#0284c7", "#16a34a",
] as const;
function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

/** Org default tax rate from the Convex orgSettings mirror (source of truth; the
 *  Postgres column is deprecated). null when unset. Resolved IN-mutation so browser
 *  callers can't spoof a money-affecting tax rate. */
async function resolveOrgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

/** Delete a line + its fulfillment units (replica of deleteLineWithUnits). The unit
 *  cascade org-filters: by_lineItemId is a GLOBAL index, so without the org guard a
 *  cuid-colliding line in another org could have its units swept. */
async function deleteLineWithUnits(ctx: MutationCtx, lineDocId: Id<"projectLineItems">, lineCuid: string, orgId: string) {
  const units = (await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineCuid))
    .collect()).filter((u) => u.organizationId === orgId);
  for (const u of units) await ctx.db.delete(u._id);
  await ctx.db.delete(lineDocId);
}

export const removeNative = mutation({
  returns: v.object({ projectId: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    // Gate for the folded collab/webhook side-effects. OPTIONAL + only honored when
    // `=== true`, so the pre-fold app image (never passes it) does NOT double-emit —
    // its own server tail still emits during the deploy window; the new app/browser
    // passes emitSideEffects:true once its tail is conditionalized off. Expand-contract.
    emitSideEffects: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, emitSideEffects, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!line) throw new ConvexError({ code: "NOT_FOUND", message: "This item was deleted by someone else. Refresh the page." });
    if (line.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Child items (kit members, sub-hire group children, accessory children) are
    // removed via their parent, never individually — same guard as removeLineItem.
    if (line.isKitChild) {
      const isAccessory = line.childKind === "ACCESSORY";
      throw new ConvexError({
        code: isAccessory ? "ACCESSORY_CHILD" : "KIT_CHILD",
        message: isAccessory ? "This item is an accessory of another asset." : "This item is part of a Kit.",
      });
    }

    // Cascade-delete the children (+ their units) and the line (+ its units) — the
    // exact removeLineItemCascade sequence, now atomic with the guard + audit.
    const children = (await ctx.db
      .query("projectLineItems")
      .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
      .collect()).filter((c) => c.organizationId === orgId);
    for (const c of children) await deleteLineWithUnits(ctx, c._id, c.id, orgId);
    await deleteLineWithUnits(ctx, line._id, line.id, orgId);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "lineItem",
      entityId: id,
      entityName: line.description || "Line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Removed line item from project",
      projectId: line.projectId,
      createdAt: now,
    });

    // Recalc project totals in the SAME transaction (Option A — collapses the write
    // to one round-trip; org default tax resolved in-mutation from orgSettings, the
    // source of truth, so a browser caller can't spoof it).
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, line.projectId, orgId, orgDefaultTaxRate, now);

    // Collab feed — folded from the server tail (writeCollabActivityEvent
    // "line_item_removed"), now transactional. entityId=project, target=the line.
    if (emitSideEffects === true) {
      await ctx.db.insert("activityEvents", {
        orgId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: line.projectId,
        targetType: "lineItem",
        targetId: id,
        action: "line_item_removed",
        summary: `removed ${line.description || "a line item"}`,
        createdAt: now,
      });
    }

    return { projectId: line.projectId };
  },
});

/**
 * removeManyNative — browser-direct bulk line-item remove. RBAC(project, manage_line_items).
 *
 * Byte-parity port of the deleted `removeLineItemsBatch` server action (+ its Convex
 * `removeManyCascade`): one backend-local pass loops the ids, org-scopes + child-guards
 * each row (a kit/accessory/sub-hire child is removed via its parent, never individually
 * — so it's SKIPPED here, matching the server), cascade-deletes each removable line's
 * children + units via the same `deleteLineWithUnits` removeNative uses, then writes ONE
 * aggregate DELETE audit and recalcs each affected project ONCE. All atomic. The org
 * default tax rate is resolved in-mutation from orgSettings (a browser caller can't spoof it).
 */
export const removeManyNative = mutation({
  returns: v.object({ removed: v.number(), skipped: v.number() }),
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { ids, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    let removed = 0;
    let skipped = 0;
    // Affected projectIds in first-seen order (recalc each once; audit uses [0]).
    const affected: string[] = [];
    const affectedSet = new Set<string>();

    for (const id of ids) {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      // Missing / cross-org (by_cuid is GLOBAL) / a child item → skipped, never removed.
      if (!line || line.organizationId !== orgId || line.isKitChild) {
        skipped++;
        continue;
      }
      const children = (await ctx.db
        .query("projectLineItems")
        .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
        .collect()).filter((c) => c.organizationId === orgId);
      for (const c of children) await deleteLineWithUnits(ctx, c._id, c.id, orgId);
      await deleteLineWithUnits(ctx, line._id, line.id, orgId);
      if (!affectedSet.has(line.projectId)) {
        affectedSet.add(line.projectId);
        affected.push(line.projectId);
      }
      removed++;
    }

    if (removed > 0) {
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: orgId,
        action: "DELETE",
        entityType: "lineItem",
        entityId: ids[0],
        entityName: `${removed} line item${removed === 1 ? "" : "s"}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Removed ${removed} line item${removed === 1 ? "" : "s"} from project`,
        projectId: affected[0],
        createdAt: now,
      });
      const rate = await resolveOrgDefaultTaxRate(ctx, orgId);
      for (const pid of affected) await recalcProjectTotals(ctx, pid, orgId, rate, now);
    }

    return { removed, skipped };
  },
});

/**
 * Fields a client must NEVER set or clear on a line via `patchNative` (a public mutation
 * with a `set: v.any()` surface). None are sent by the two legit callers
 * (src/server/line-items.ts updateLineItem — quantity/pricingType/duration/isOptional/
 * showSubhireOnDocs/description/unitPrice/discount/lineTotal/groupName/notes/
 * subhireOrderNumber/modelId/assetId/bulkAssetId/supplierId), so stripping them is
 * non-breaking. Covers: the tenant/immutable anchors, the parent/child structural tree
 * (a forged `isKitChild`/`parentLineItemId` corrupts the ~40 kit-child filters + recalc),
 * lifecycle/status (`status:"CANCELLED"` silently drops a line from revenue), the
 * warehouse fulfillment counters, the recalc-owned allocation fields, and the internal
 * sub-hire linkage. Money integrity of the ALLOWED fields is enforced separately by
 * assertLineMoneyFields. */
const LINE_IMMUTABLE_ON_PATCH = [
  "projectId",
  // NOTE: `type` is intentionally NOT here — updateLineItem legitimately patches it.
  "kitId", "isKitChild", "childKind", "parentLineItemId", "pricingMode", "isCustomItem", "isContainerLineItem",
  "status", "returnStatus", "prepStatus", "prepContainer", "returnCondition", "returnNotes",
  "checkedOutQuantity", "returnedQuantity", "assignedQuantity", "packedQuantity", "damagedQuantity", "lostQuantity",
  "checkedOutAt", "checkedOutById", "returnedAt", "returnedById",
  "allocatedRevenue", "allocationBasis",
  "subHireId", "subHireItemId", "subHireGroupId", "supplierOrderId",
  "createdAt",
] as const;

const LINE_NEVER_CLEAR = new Set<string>(["id", "organizationId", ...LINE_IMMUTABLE_ON_PATCH]);

/**
 * patchNative — apply a set/clear patch to a line item + UPDATE audit, atomic.
 * RBAC(project, manage_line_items). The server action still does the availability
 * re-check (cross-project, on quantity increase) + the stale-revision guard + builds
 * set/clear; the write + audit move here. recalc stays server-side (post-write).
 */
export const patchNative = mutation({
  returns: v.object({ projectId: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    set: v.any(),
    clear: v.array(v.string()),
    entityName: v.string(),
    allowOverbook: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    // Gate for the folded collab/webhook side-effects. OPTIONAL + only honored when
    // `=== true`, so the pre-fold app image (never passes it) does NOT double-emit —
    // its own server tail still emits during the deploy window; the new app/browser
    // passes emitSideEffects:true once its tail is conditionalized off. Expand-contract.
    emitSideEffects: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, entityName, allowOverbook, actor: suppliedActor, auditId, emitSideEffects, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError({ code: "NOT_FOUND", message: "This item was deleted by someone else. Refresh the page." });
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Strip organizationId/id + the structural/fulfillment/allocation/lifecycle fields a
    // client must never patch (see LINE_IMMUTABLE_ON_PATCH), then bound-check the money
    // fields it CAN set — a browser-direct caller bypasses the server-side Zod.
    const setObj = sanitizeClientSet(set, LINE_IMMUTABLE_ON_PATCH);
    assertLineMoneyFields(setObj as {
      quantity?: number; unitPrice?: number; discount?: number; duration?: number; lineTotal?: number;
    });

    // Availability re-check on a quantity INCREASE (parity with updateLineItem's
    // server-side re-check). Only EQUIPMENT, model-backed, non-sub-hire lines that grow
    // are re-validated. The EFFECTIVE post-patch view must respect `clear` (a caller can
    // clear modelId to convert to a custom line — the server then skips enforcement).
    const currentQty = doc.quantity ?? 0;
    const clearSet = new Set(clear.filter((k) => !LINE_NEVER_CLEAR.has(k)));
    const effField = (key: string): unknown =>
      clearSet.has(key) ? undefined : ((setObj as Record<string, unknown>)[key] ?? (doc as Record<string, unknown>)[key]);
    const effType = effField("type");
    const effModelId = effField("modelId") as string | undefined;
    const newQty = clearSet.has("quantity") ? currentQty : ((setObj.quantity as number | undefined) ?? currentQty);
    // Gate is `newQty > currentQty` (NOT `!sameModel || ...`) to stay BYTE-parity with
    // updateLineItem (src/server/line-items.ts:565-573), which ALSO skips enforcement when
    // the new qty isn't an increase — even on a model change. Over-enforcing here would
    // throw where the service-token server path does not, breaking the legit path. (A model
    // change with a lower qty escaping the check is a pre-existing server gap, out of scope
    // for a parity port.)
    if (
      effType === "EQUIPMENT" &&
      effModelId &&
      doc.subHireId == null && // subHireId is immutable-on-patch, so read from the doc
      !allowOverbook &&
      newQty > currentQty
    ) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", doc.projectId)).unique();
      const bundle = await loadModelAvailabilityBundle(ctx, effModelId, orgId);
      if (bundle.model) {
        const { available, booked, unavailable, totalStock } = computeModelAvailability(bundle, {
          rentalStart: project?.rentalStartDate ?? null,
          rentalEnd: project?.rentalEndDate ?? null,
          excludeProjectId: doc.projectId,
        });
        // If the model is UNCHANGED, this line's currentQty is already in `booked`, so
        // compare the DELTA (== updateLineItem's exclude-this-line semantics). If the model
        // CHANGED, the line is NOT in the new model's `booked`, so compare the full newQty.
        const sameModel = doc.modelId != null && effModelId === doc.modelId;
        const requested = sameModel ? newQty - currentQty : newQty;
        if (requested > available) {
          const detail = unavailable > 0
            ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
            : `${booked} already booked out of ${totalStock} total`;
          throw new ConvexError({
            code: "INSUFFICIENT_STOCK",
            message: `Only ${available} of ${requested} requested are free during those dates.`,
            hint: `Stock: ${detail}. Reduce the quantity, change the dates, or add a sub-hire to cover the gap.`,
          });
        }
      }
    }

    if (clear.length === 0) {
      await ctx.db.patch(doc._id, setObj);
    } else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...setObj };
      for (const k of clear) {
        if (LINE_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(doc._id, merged as typeof rest);
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "lineItem",
      entityId: id,
      entityName,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Updated line item on project",
      projectId: doc.projectId,
      createdAt: now,
    });

    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, doc.projectId, orgId, orgDefaultTaxRate, now);

    // Collab feed — folded from updateLineItem's server tail (writeCollabActivityEvent
    // "line_item_updated"), now transactional. Summary + metadata read the POST-patch
    // line (parity with the server, which built these from readBackLine(id) after the
    // write). metadata drops an undefined quantity to match the Convex client stripping
    // it over the wire on the server path.
    if (emitSideEffects === true) {
      const updated = await ctx.db.get(doc._id);
      await ctx.db.insert("activityEvents", {
        orgId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: doc.projectId,
        targetType: "lineItem",
        targetId: id,
        action: "line_item_updated",
        summary: `updated ${updated?.description || "a line item"}`,
        metadata: dropUndefined({
          quantity: updated?.quantity,
          lineTotal: updated?.lineTotal != null ? String(updated.lineTotal) : null,
        }),
        createdAt: now,
      });
    }

    return { projectId: doc.projectId };
  },
});

/**
 * patchManyNative — browser-direct bulk line-item EDIT (shared fields). RBAC(project,
 * manage_line_items). Byte-parity port of the deleted `updateLineItemsBatch` server
 * action (+ its Convex `patchMany`): loops the ids, org-scopes + child-guards each row
 * (kit/accessory/sub-hire children are SKIPPED), builds the set/clear IN-mutation from the
 * shared `patch`, then writes ONE aggregate UPDATE audit + recalcs each affected project once.
 *
 * MONEY — the discount %/lineTotal recompute reads the DOC's OWN unitPrice/quantity/duration
 * (never a client-supplied base), so a browser caller can't inflate a line total by lying
 * about the base. Only `patch.discount.{mode,value}` (the intended input) is client-supplied,
 * and `assertLineMoneyFields` bound-checks the resulting discount/lineTotal before it lands.
 */
export const patchManyNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    patch: v.object({
      pricingType: v.optional(v.string()),
      discount: v.optional(v.union(v.object({ mode: v.string(), value: v.number() }), v.null())),
      notes: v.optional(v.union(v.string(), v.null())),
      isOptional: v.optional(v.boolean()),
    }),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { ids, orgId, patch, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    let updated = 0;
    let skipped = 0;
    // Affected projectIds in first-seen order (recalc each once; audit uses [0]).
    const affected: string[] = [];
    const affectedSet = new Set<string>();

    for (const id of ids) {
      const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      // Missing / cross-org (by_cuid is GLOBAL) / a child item → skipped, never edited.
      if (!doc || doc.organizationId !== orgId || doc.isKitChild) {
        skipped++;
        continue;
      }

      // Build set/clear IN-mutation — byte-parity with updateLineItemsBatch, reading the
      // doc's OWN money fields (never the client's) for the % discount + lineTotal recompute.
      const set: Record<string, unknown> = { updatedAt: now };
      const clear: string[] = [];

      if (patch.pricingType !== undefined) set.pricingType = patch.pricingType;
      if (patch.isOptional !== undefined) set.isOptional = patch.isOptional;
      if (patch.notes !== undefined) {
        if (patch.notes == null || patch.notes === "") clear.push("notes");
        else set.notes = patch.notes;
      }

      if (patch.discount !== undefined) {
        let discountApplied: number | undefined;
        if (patch.discount == null || patch.discount.value <= 0) {
          clear.push("discount");
          discountApplied = undefined;
        } else if (patch.discount.mode === "%") {
          const base = (doc.unitPrice ?? 0) * (doc.quantity ?? 0) * (doc.duration ?? 1);
          discountApplied = roundCurrency((base * patch.discount.value) / 100);
          set.discount = discountApplied;
        } else {
          discountApplied = patch.discount.value;
          set.discount = discountApplied;
        }
        // Discount feeds the stored line total — recompute from the item's own
        // price/quantity/duration (unchanged) + the new discount.
        const lineTotal = computeLineTotal(
          doc.unitPrice ?? undefined,
          doc.quantity ?? 0,
          doc.duration ?? 1,
          discountApplied,
        );
        if (lineTotal == null) clear.push("lineTotal");
        else set.lineTotal = lineTotal;
      }

      // Belt-and-braces bound-check on the money fields this bulk edit can touch (a
      // browser-direct caller bypasses the server-side Zod).
      assertLineMoneyFields(set as {
        quantity?: number; unitPrice?: number; discount?: number; duration?: number; lineTotal?: number;
      });

      if (clear.length === 0) {
        await ctx.db.patch(doc._id, set);
      } else {
        const { _id, _creationTime, ...rest } = doc;
        const merged: Record<string, unknown> = { ...rest, ...set };
        for (const k of clear) {
          if (LINE_NEVER_CLEAR.has(k)) continue;
          delete merged[k];
        }
        await ctx.db.replace(doc._id, merged as typeof rest);
      }

      if (!affectedSet.has(doc.projectId)) {
        affectedSet.add(doc.projectId);
        affected.push(doc.projectId);
      }
      updated++;
    }

    if (updated > 0) {
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: orgId,
        action: "UPDATE",
        entityType: "lineItem",
        entityId: ids[0],
        entityName: `${updated} line item${updated === 1 ? "" : "s"}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Bulk edited ${updated} line item${updated === 1 ? "" : "s"}`,
        projectId: affected[0],
        createdAt: now,
      });
      const rate = await resolveOrgDefaultTaxRate(ctx, orgId);
      for (const pid of affected) await recalcProjectTotals(ctx, pid, orgId, rate, now);
    }

    return { updated, skipped };
  },
});

/** Next sort order for a project's lines (replica of nextLineSort). */
async function nextLineSort(ctx: MutationCtx, projectId: string, organizationId: string): Promise<number> {
  // desc-first on by_projectId_sortOrder (1 doc) instead of collecting all the
  // project's lines to reduce the max (O(N) per add, O(N^2) across a bulk add).
  const top = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_sortOrder", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
  return ((top && top.organizationId === organizationId ? top.sortOrder : undefined) ?? -1) + 1;
}

// ─── addLineItemSmartNative helpers (money-math ports) ────────────────────────

/** roundCurrency port (src/lib/formatters.ts:27) — bankers-free half-up on cents. */
const roundCurrencyNative = (n: number): number => Math.round(n * 100) / 100;

/**
 * Byte-parity port of src/server/line-items.ts:1595 `calculateLineTotal`:
 * unitPrice==null → null; gross=round(unitPrice·qty·duration); result=max(0, round(gross−disc)).
 */
function calcLineTotalNative(
  unitPrice: number | undefined,
  quantity: number,
  duration: number,
  discount: number | undefined,
): number | null {
  if (unitPrice == null) return null;
  const gross = roundCurrencyNative(unitPrice * quantity * duration);
  const disc = discount ?? 0;
  return Math.max(0, roundCurrencyNative(gross - disc));
}

/**
 * Org-validate a client-supplied FK id against `by_cuid` (a GLOBAL index — the row could
 * belong to another org). Throws if the referenced row is missing or cross-org. All five
 * tables carry `id` (by_cuid) + `organizationId`.
 */
async function assertRefInOrg(
  ctx: MutationCtx,
  table: "models" | "assets" | "bulkAssets" | "projectGroups" | "projectCategories",
  id: string,
  orgId: string,
): Promise<void> {
  const doc = await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== orgId) {
    throw new ConvexError({ code: "FORBIDDEN", message: `Referenced ${table} not found in your organization.` });
  }
}

/**
 * Recompute + persist a project group's suggested price (mirrors the server
 * calculateSuggestedPrice + projectGroupsWrites.recomputeGroupSuggestedById). No-op if
 * the group is gone / cross-org. Uses the shared computeGroupSuggestedPrice port.
 */
async function recomputeGroupSuggestedNative(
  ctx: MutationCtx,
  groupId: string,
  orgId: string,
  now: number,
): Promise<void> {
  const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!group || group.organizationId !== orgId) return;
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", group.projectId)).first();
  const suggested = await computeGroupSuggestedPrice(ctx, {
    projectId: group.projectId,
    groupId,
    orgId,
    defaultRentalPeriod: project?.defaultRentalPeriod ?? undefined,
    defaultRentalQuantity: project?.defaultRentalQuantity ?? undefined,
    groupRentalPeriod: group.rentalPeriod ?? undefined,
    groupRentalQuantity: group.rentalQuantity ?? undefined,
  });
  await ctx.db.patch(group._id, { suggestedPrice: suggested, updatedAt: now });
}

/** Drop keys whose value is undefined (parity with the Convex client stripping undefined
 *  args over the wire — the server merge/insert relied on that to mean "leave unset"). */
function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

/**
 * Emit the `line_item_added` collab event + `line_item.added` webhook for a resulting
 * line (parity with addLineItem's server tail — writeCollabActivityEvent + emitWebhookEvent).
 * Both the merge and insert returns of addLineItemSmartNative call this with the resulting
 * line's POST-write values. The collab insert is transactional; the webhook enqueue is
 * best-effort (swallowed — a webhook failure must never roll back the add, mirroring emit).
 */
async function emitLineItemAdded(
  ctx: MutationCtx,
  args: {
    orgId: string;
    actor: { userId: string; userName: string };
    projectId: string;
    line: { id: string; modelId?: string | null; quantity?: number | null; type?: string | null; description?: string | null };
    now: number;
  },
): Promise<void> {
  const { orgId, actor, projectId, line, now } = args;
  await ctx.db.insert("activityEvents", {
    orgId,
    actorUserId: actor.userId,
    actorName: actor.userName,
    actorColor: getUserColor(actor.userId),
    entityType: "project",
    entityId: projectId,
    targetType: "lineItem",
    targetId: line.id,
    action: "line_item_added",
    summary: `added ${line.description || "a line item"}`,
    createdAt: now,
  });
  try {
    await enqueueWebhookEvent(ctx, orgId, "line_item.added", {
      projectId,
      lineItemId: line.id,
      modelId: line.modelId ?? null,
      quantity: line.quantity ?? null,
      type: line.type ?? null,
      description: line.description ?? null,
    }, now);
  } catch {
    // Best-effort: a webhook read/insert failure must never roll back the add.
  }
}

/**
 * addCustomNative — insert a custom (non-inventory) line item + CREATE audit, atomic.
 * RBAC(project, manage_line_items). Custom items never consume inventory, so there's
 * NO availability check to keep server-side — this is a fully-native add. sortOrder is
 * computed in-mutation (nextLineSort replica); recalc stays server-side (post-write).
 */
export const addCustomNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fields: v.object({
      description: v.optional(v.string()),
      quantity: v.number(),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      groupName: v.optional(v.string()),
      lineTotal: v.optional(v.number()),
    }),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    // Gate for the folded collab/webhook side-effects. OPTIONAL + only honored when
    // `=== true`, so the pre-fold app image (never passes it) does NOT double-emit —
    // its own server tail still emits during the deploy window; the new app/browser
    // passes emitSideEffects:true once its tail is conditionalized off. Expand-contract.
    emitSideEffects: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, actor: suppliedActor, auditId, emitSideEffects, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);
    await assertProjectInOrg(ctx, projectId, organizationId); // client projectId — must be the caller's org (see helper)

    assertLineMoneyFields(fields); // reject NaN/Infinity/out-of-range before it reaches recalc

    // Dup-guard the client-minted id (by_cuid is global + non-unique) — a reused id
    // both breaks .unique() reads AND (with the unit cascade) enables a cross-org delete.
    const dup = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError("Line item already exists");

    const sortOrder = await nextLineSort(ctx, projectId, organizationId);
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      ...fields,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: fields.description || "Custom item",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added custom item "${fields.description ?? ""}" to project`,
      projectId,
      createdAt: now,
    });

    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);

    // Collab feed — folded from addCustomLineItem's server tail
    // (writeCollabActivityEvent "custom_item_added"), now transactional.
    if (emitSideEffects === true) {
      await ctx.db.insert("activityEvents", {
        orgId: organizationId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: projectId,
        targetType: "lineItem",
        targetId: id,
        action: "custom_item_added",
        summary: `added custom item "${fields.description ?? ""}"`,
        createdAt: now,
      });
    }

    return { id };
  },
});

/**
 * addNative — insert an inventory line item (+ atomic accessory expansion via the
 * shared expandAccessoryChildLines, the SAME helper createLineItem uses) + CREATE
 * audit, all in one transaction. RBAC(project, manage_line_items).
 *
 * Option A: the server action keeps the cross-project availability/double-booking
 * check (reads overlapping projects — a mutation can't safely do that at scale) and
 * the price computation; it passes the resolved `fields`, and this mutation does the
 * atomic write (parent + accessory children + units) + audit. recalc stays server-side.
 */
export const addNative = mutation({
  returns: v.object({ id: v.string(), sortOrder: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fields: v.object({
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      type: v.optional(enums.LineItemType),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.number(),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      groupName: v.optional(v.string()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      showSubhireOnDocs: v.optional(v.boolean()),
      supplierId: v.optional(v.string()),
      subhireOrderNumber: v.optional(v.string()),
    }),
    includeAccessories: v.boolean(),
    allowOverbook: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, includeAccessories, allowOverbook, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    // The client supplies `projectId`; requireOrgPermission only proves the caller's
    // org. Verify the target project IS that org's — else a member could insert a line
    // (stamped with their org) into ANOTHER org's project, which recalcProjectTotals
    // (collects lines by projectId, no org filter) would sweep into that org's totals.
    await assertProjectInOrg(ctx, projectId, organizationId);
    assertLineMoneyFields(fields); // reject NaN/Infinity/out-of-range before it reaches recalc

    // Dup-guard the client-minted id (by_cuid is global + non-unique) — a reused id
    // both breaks .unique() reads AND (with the unit cascade) enables a cross-org delete.
    const dupLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dupLine) throw new ConvexError("Line item already exists");

    // Availability / double-booking enforcement, IN the mutation (parity with the
    // server-action pre-check at src/server/line-items.ts). Runs in ADDITION to the
    // service-authed server pre-check; it only throws in the same cases the server
    // does, so it's non-breaking for the legit path and self-sufficient for a future
    // browser-direct caller. Sub-hire items never consume our stock (excluded).
    if (fields.type === "EQUIPMENT" && fields.modelId && !allowOverbook) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
      const rentalStart = project?.rentalStartDate ?? null;
      const rentalEnd = project?.rentalEndDate ?? null;
      const hasDates = rentalStart != null && rentalEnd != null;

      if (fields.assetId) {
        // (a) Kit membership — a kit asset must be booked via the kit workflow.
        const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", fields.assetId!)).unique();
        if (asset && asset.organizationId === organizationId && asset.kitId) {
          const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", asset.kitId!)).unique();
          const kitTag = kit && kit.organizationId === organizationId ? kit.assetTag : asset.kitId;
          throw new ConvexError({
            code: "ASSET_IN_KIT",
            title: "Asset is in a kit",
            message: `This asset belongs to Kit ${kitTag}.`,
            hint: "Add the Kit to the project instead, or remove the asset from the Kit first.",
          });
        }
        // (b) Dated double-booking across overlapping projects (legacy line OR unit).
        if (hasDates) {
          const conflict = await findAssetConflict(ctx, {
            assetId: fields.assetId,
            orgId: organizationId,
            excludeProjectId: projectId,
            rentalStart,
            rentalEnd,
          });
          if (conflict) {
            throw new ConvexError({
              code: "ASSET_DOUBLE_BOOKED",
              message: `This asset is booked on ${conflict.projectNumber} — ${conflict.name} during those dates.`,
            });
          }
        }
        // (c) Permanently unavailable (retired / lost).
        if (asset && asset.organizationId === organizationId && (asset.status === "RETIRED" || asset.status === "LOST")) {
          throw new ConvexError({
            code: "ASSET_UNAVAILABLE",
            message: `This asset is marked ${asset.status.replace("_", " ").toLowerCase()}.`,
            hint: asset.status === "LOST"
              ? "Find the asset and mark it Available, or pick a different one."
              : "Retired assets cannot be booked. Pick a different asset.",
          });
        }
      } else {
        // Model-level — enforce quantity against effective stock.
        const bundle = await loadModelAvailabilityBundle(ctx, fields.modelId, organizationId);
        if (bundle.model) {
          const { available, booked, unavailable, totalStock } = computeModelAvailability(bundle, {
            rentalStart,
            rentalEnd,
            excludeProjectId: projectId,
          });
          if (fields.quantity > available) {
            const detail = unavailable > 0
              ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
              : `${booked} already booked out of ${totalStock} total`;
            throw new ConvexError({
              code: "INSUFFICIENT_STOCK",
              message: `Only ${available} of ${fields.quantity} requested are free during those dates.`,
              hint: `Stock: ${detail}. Reduce the quantity, change the dates, or add a sub-hire to cover the gap.`,
            });
          }
        }
      }
    }

    // Mirrors createLineItem exactly (sortOrder in-mutation, no TOCTOU; permanent
    // accessories expanded as child lines atomically via the shared helper).
    const sortOrder = await nextLineSort(ctx, projectId, organizationId);
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId,
      ...fields,
      status: "CONFIRMED",
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    if (includeAccessories && fields.type === "EQUIPMENT" && (fields.assetId || fields.modelId)) {
      await expandAccessoryChildLines(ctx, {
        id,
        assetId: fields.assetId,
        modelId: fields.modelId,
        quantity: fields.quantity,
        categoryId: fields.categoryId,
        groupId: fields.groupId,
        duration: fields.duration,
        pricingType: fields.pricingType,
        organizationId,
        projectId,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: fields.description || "Line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Added line item to project",
      projectId,
      createdAt: now,
    });

    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);
    return { id, sortOrder };
  },
});

/**
 * addKitNative — add a kit to a project: parent line + expanded member child lines
 * (ITEMIZED pricing) via the SHARED createKitLineItemCore (same code createKitLineItem
 * runs) + CREATE audit, atomic. RBAC(project, manage_line_items). The kit
 * availability / double-booking check stays server-side; recalc stays server-side.
 */
export const addKitNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    kitId: v.string(),
    unitPrice: v.optional(v.number()),
    pricingMode: enums.KitPricingMode,
    groupName: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    kitLabel: v.string(),
    // Bulk callers (e.g. applyGroupTemplate) pass false + log one grouped collab event
    // instead — parity with addKitLineItem's emitActivity param. OPTIONAL + gated on
    // `=== true` (below) so the pre-fold app image (which never passes it) does NOT
    // double-emit kit_added: the old app's own tail still emits it during the deploy
    // window, and only the new app/browser passes emitActivity:true once its tail is
    // conditionalized off. Expand-contract.
    emitActivity: v.optional(v.boolean()),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, kitLabel, emitActivity, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    // The client supplies projectId; verify it's the caller's org before reading it or
    // sweeping its lines (by_cuid is global) — same guard addNative applies.
    await assertProjectInOrg(ctx, projectId, organizationId);

    // Dup-guard the client-minted kit-line id (by_cuid is global + non-unique).
    const dupKit = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dupKit) throw new ConvexError("Line item already exists");

    // Kit availability enforcement (parity with addKitLineItem, src/server/line-items.ts:
    // 811-860). UNCONDITIONAL — no allowOverbook for kits. (createKitLineItemCore re-reads
    // + org-validates the kit; this pre-read is only for the guards.)
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).unique();
    if (kit && kit.organizationId === organizationId) {
      // (a) Block truly unavailable kits (allow checked-out — the date check handles those).
      if (kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") {
        throw new ConvexError({
          code: "KIT_UNAVAILABLE",
          title: "Kit cannot be added",
          message: `Kit ${kit.assetTag} is ${kit.status.replace("_", " ").toLowerCase()}.`,
          hint: kit.status === "IN_MAINTENANCE"
            ? "Wait for maintenance to finish, or pick a different kit."
            : "Complete the kit's missing items before booking it.",
        });
      }
      // (b) Dated double-booking on an overlapping project (parent kit line only).
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
      if (project?.rentalStartDate != null && project?.rentalEndDate != null) {
        const conflict = await findKitConflict(ctx, {
          kitId,
          orgId: organizationId,
          excludeProjectId: projectId,
          rentalStart: project.rentalStartDate,
          rentalEnd: project.rentalEndDate,
        });
        if (conflict) {
          throw new ConvexError({
            code: "KIT_DOUBLE_BOOKED",
            title: "Kit already booked",
            message: `Kit ${kit.assetTag} is on ${conflict.projectNumber ?? conflict.id} — ${conflict.name ?? ""} during those dates.`,
            hint: "Pick a different kit, adjust the rental dates, or remove it from the other project.",
          });
        }
      }
    }

    await createKitLineItemCore(ctx, {
      id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, now,
    });

    // Parity with the deleted addKitLineItem: when the client can't resolve the kit
    // label (kit absent from the current search results), derive it server-side from the
    // kit doc — "<assetTag> - <name>" — so the audit + collab feed never show a blank kit.
    const resolvedKitLabel =
      kitLabel.trim() || (kit ? `${kit.assetTag} - ${kit.name}` : kitLabel);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: resolvedKitLabel,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added kit ${resolvedKitLabel} to project`,
      projectId,
      kitId,
      createdAt: now,
    });

    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);

    // Collab feed — folded from addKitLineItem's server tail (writeCollabActivityEvent
    // "kit_added"), now transactional. Gated on emitActivity (bulk callers pass false).
    // memberCount = the member child lines the shared core just created (= kit
    // serialized + bulk members), matching the server's kit.serializedItems.length +
    // kit.bulkItems.length. parentItem.description === kitLabel (the parent line's
    // description is `${assetTag} - ${name}`), so the summary reads it from kitLabel.
    if (emitActivity === true) {
      const memberChildren = await ctx.db
        .query("projectLineItems")
        .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
        .collect();
      const memberCount = memberChildren.filter((c) => c.organizationId === organizationId).length;
      await ctx.db.insert("activityEvents", {
        orgId: organizationId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: projectId,
        targetType: "lineItem",
        targetId: id,
        action: "kit_added",
        summary: `added kit "${resolvedKitLabel}" (${memberCount} item${memberCount === 1 ? "" : "s"})`,
        createdAt: now,
      });
    }

    return { id };
  },
});

/**
 * reorderNative — bulk sort-order / groupName update for a project's lines. RBAC
 * (project, manage_line_items). Mirrors reorderLineItems; org-scopes each row. No
 * audit (reorder is not audited on the legacy path).
 */
export const reorderNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    items: v.array(v.object({ id: v.string(), sortOrder: v.number(), groupName: v.optional(v.string()) })),
    now: v.number(),
  },
  handler: async (ctx, { orgId, items, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    for (const it of items) {
      const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", it.id)).first();
      if (doc && doc.organizationId === orgId) {
        await ctx.db.patch(doc._id, { sortOrder: it.sortOrder, groupName: it.groupName, updatedAt: now });
      }
    }
    return { ok: true as const };
  },
});

/**
 * recalcNative — recompute + persist a project's derived totals, backend-local.
 *
 * A drop-in for src/server/line-items.ts `recalculateProjectTotals`: that function
 * did ~3 sequential server→Convex-Cloud round-trips (project read → parallel wave of
 * 5 collection reads → project write), the common ~6–12s write tail. This does the
 * whole thing in ONE mutation (all reads/writes are backend-local). Every write
 * across the app (line-items, groups, services, sub-hires, project edits) funnels
 * through recalculateProjectTotals, so this single collapse speeds up ALL of them.
 *
 * orgDefaultTaxRate is resolved in-mutation from orgSettings (the source of truth), so
 * a browser caller can't spoof a money-affecting tax rate.
 * Gated behind NATIVE_RECALC; parity with the server-side math is proven by
 * convex/recalc.test.ts (recalcProjectTotals, the shared core).
 */
export const recalcNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    now: v.number(),
  },
  handler: async (ctx, { projectId, orgId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, projectId, orgId, orgDefaultTaxRate, now);
    return { ok: true as const };
  },
});

/**
 * addLineItemSmartNative — the FULL browser-direct port of src/server/line-items.ts
 * `addLineItem` (the money-adjacent add orchestration), all in one atomic mutation:
 *
 *   guards → FK org-validation → availability/double-booking → merge-dedup
 *   → auto-pricing → build fields → insert → accessory expansion → group-suggested-price
 *   → recalc.
 *
 * The availability block is copied verbatim from `addNative`; the three still-server-only
 * pieces are ported here for byte-parity:
 *   • auto-pricing  (src/server/line-items.ts:361-401) — PER_DAY, no manual price → fill
 *     from the model's daily/weekly rate × the project's default rental quantity.
 *   • merge-dedup   (src/server/line-items.ts:266-358) — a model-backed, asset-less,
 *     same-group/category add merges into the existing line (quantity summed, lineTotal
 *     recomputed, notes joined) instead of inserting a duplicate row.
 *   • group-suggested-price (computeGroupSuggestedPrice) — persisted onto the group.
 *
 * lineTotal is ALWAYS recomputed in-mutation (calcLineTotalNative) — never trusted from
 * the client. `fields.lineTotal` is intentionally absent from the args.
 */
export const addLineItemSmartNative = mutation({
  returns: v.object({ id: v.string(), merged: v.boolean() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fields: v.object({
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      type: v.optional(enums.LineItemType),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.number(),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      groupName: v.optional(v.string()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      showSubhireOnDocs: v.optional(v.boolean()),
      supplierId: v.optional(v.string()),
      subhireOrderNumber: v.optional(v.string()),
    }),
    allowOverbook: v.boolean(),
    forceSeparate: v.boolean(),
    includeAccessories: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image
    // (which still passes it while NATIVE_LINEITEM_WRITES is on in prod). The rate is
    // ALWAYS resolved in-mutation from orgSettings — a client value is never trusted.
    // Remove once the arg-less app image is deployed (expand-contract CONTRACT step).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    // Gate for the folded collab/webhook side-effects. OPTIONAL + only honored when
    // `=== true`, so the pre-fold app image (never passes it) does NOT double-emit —
    // its own server tail still emits during the deploy window; the new app/browser
    // passes emitSideEffects:true once its tail is conditionalized off. Expand-contract.
    emitSideEffects: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, {
    id, organizationId, projectId, fields, allowOverbook, forceSeparate, includeAccessories,
    actor: suppliedActor, auditId, emitSideEffects, now,
  }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    // Client-supplied projectId: prove it's the caller's org before reading/sweeping its
    // lines (by_cuid + by_projectId are GLOBAL). Then bound-check the money inputs.
    await assertProjectInOrg(ctx, projectId, organizationId);
    assertLineMoneyFields(fields); // reject NaN/Infinity/out-of-range before it reaches recalc

    // Org default tax rate resolved in-mutation from orgSettings (source of truth) so a
    // browser caller can't spoof it. Used by recalc on both the merge and insert paths.
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);

    // Org-validate every referenced FK (by_cuid is global — the row could be another org's).
    if (fields.modelId) await assertRefInOrg(ctx, "models", fields.modelId, organizationId);
    if (fields.assetId) await assertRefInOrg(ctx, "assets", fields.assetId, organizationId);
    if (fields.bulkAssetId) await assertRefInOrg(ctx, "bulkAssets", fields.bulkAssetId, organizationId);
    if (fields.groupId) await assertRefInOrg(ctx, "projectGroups", fields.groupId, organizationId);
    if (fields.categoryId) await assertRefInOrg(ctx, "projectCategories", fields.categoryId, organizationId);

    // ── Availability / double-booking (copied verbatim from addNative) ─────────
    if (fields.type === "EQUIPMENT" && fields.modelId && !allowOverbook) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
      const rentalStart = project?.rentalStartDate ?? null;
      const rentalEnd = project?.rentalEndDate ?? null;
      const hasDates = rentalStart != null && rentalEnd != null;

      if (fields.assetId) {
        const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", fields.assetId!)).unique();
        if (asset && asset.organizationId === organizationId && asset.kitId) {
          const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", asset.kitId!)).unique();
          const kitTag = kit && kit.organizationId === organizationId ? kit.assetTag : asset.kitId;
          throw new ConvexError({
            code: "ASSET_IN_KIT",
            title: "Asset is in a kit",
            message: `This asset belongs to Kit ${kitTag}.`,
            hint: "Add the Kit to the project instead, or remove the asset from the Kit first.",
          });
        }
        if (hasDates) {
          const conflict = await findAssetConflict(ctx, {
            assetId: fields.assetId,
            orgId: organizationId,
            excludeProjectId: projectId,
            rentalStart,
            rentalEnd,
          });
          if (conflict) {
            throw new ConvexError({
              code: "ASSET_DOUBLE_BOOKED",
              message: `This asset is booked on ${conflict.projectNumber} — ${conflict.name} during those dates.`,
            });
          }
        }
        if (asset && asset.organizationId === organizationId && (asset.status === "RETIRED" || asset.status === "LOST")) {
          throw new ConvexError({
            code: "ASSET_UNAVAILABLE",
            message: `This asset is marked ${asset.status.replace("_", " ").toLowerCase()}.`,
            hint: asset.status === "LOST"
              ? "Find the asset and mark it Available, or pick a different one."
              : "Retired assets cannot be booked. Pick a different asset.",
          });
        }
      } else {
        const bundle = await loadModelAvailabilityBundle(ctx, fields.modelId, organizationId);
        if (bundle.model) {
          const { available, booked, unavailable, totalStock } = computeModelAvailability(bundle, {
            rentalStart,
            rentalEnd,
            excludeProjectId: projectId,
          });
          if (fields.quantity > available) {
            const detail = unavailable > 0
              ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
              : `${booked} already booked out of ${totalStock} total`;
            throw new ConvexError({
              code: "INSUFFICIENT_STOCK",
              message: `Only ${available} of ${fields.quantity} requested are free during those dates.`,
              hint: `Stock: ${detail}. Reduce the quantity, change the dates, or add a sub-hire to cover the gap.`,
            });
          }
        }
      }
    }

    // ── Merge-dedup (src/server/line-items.ts:266-358) ─────────────────────────
    // A model-backed, asset-less, same-group/category, non-sub-hire, non-child add merges
    // into the existing matching line (quantity summed, lineTotal recomputed) instead of
    // inserting a duplicate row. Never when forceSeparate.
    if (fields.type === "EQUIPMENT" && fields.modelId && !fields.assetId && !forceSeparate) {
      const projectLines = (
        await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
      ).filter((li) => li.organizationId === organizationId);
      const existing = projectLines.find(
        (li) =>
          li.modelId === fields.modelId &&
          li.assetId == null &&
          (li.groupId ?? null) === (fields.groupId ?? null) &&
          (li.categoryId ?? null) === (fields.categoryId ?? null) &&
          !li.isKitChild &&
          li.subHireId == null &&
          li.status !== "CANCELLED",
      );

      if (existing) {
        const newQuantity = (existing.quantity ?? 0) + fields.quantity;
        // lineTotal recomputed server-side (never trusts the client). Mirrors the server
        // merge exactly: parsed value first, else the existing row's value.
        const mergedUnitPrice = fields.unitPrice ?? (existing.unitPrice != null ? Number(existing.unitPrice) : undefined);
        const mergedDuration = fields.duration || existing.duration || 1;
        const mergedDiscount = fields.discount ?? (existing.discount != null ? Number(existing.discount) : undefined);
        const newLineTotal = calcLineTotalNative(mergedUnitPrice, newQuantity, mergedDuration, mergedDiscount);
        const mergedNotes = fields.notes
          ? existing.notes ? `${existing.notes}; ${fields.notes}` : fields.notes
          : existing.notes;

        // Only defined keys are patched (the server passed these through the Convex client,
        // which strips undefined — so `?? undefined` meant "leave the field untouched").
        const mergeSet = dropUndefined({
          quantity: newQuantity,
          unitPrice: fields.unitPrice ?? existing.unitPrice ?? undefined,
          pricingType: fields.pricingType || existing.pricingType,
          duration: fields.duration || existing.duration || undefined,
          discount: fields.discount ?? existing.discount ?? undefined,
          lineTotal: newLineTotal ?? undefined,
          groupName: fields.groupName || existing.groupName || undefined,
          notes: mergedNotes || undefined,
          updatedAt: now,
        } as Record<string, unknown>);
        await ctx.db.patch(existing._id, mergeSet);

        await writeActivityLog(ctx, {
          id: auditId,
          organizationId,
          action: "UPDATE",
          entityType: "lineItem",
          entityId: existing.id,
          entityName: existing.description || "Line item",
          userId: actor.userId,
          userName: actor.userName,
          summary: `Merged line item into existing on project (qty ${existing.quantity ?? 0} -> ${newQuantity})`,
          projectId,
          createdAt: now,
        });

        if (existing.groupId) await recomputeGroupSuggestedNative(ctx, existing.groupId, organizationId, now);
        await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);

        // Collab feed + webhook — folded from addLineItem's server tail. On a merge the
        // resulting line is `existing` with the summed quantity (parity with the server,
        // which read back existing.id after the merge).
        if (emitSideEffects === true) {
          await emitLineItemAdded(ctx, {
            orgId: organizationId,
            actor,
            projectId,
            line: {
              id: existing.id,
              modelId: existing.modelId ?? null,
              quantity: newQuantity,
              type: existing.type ?? null,
              description: existing.description ?? null,
            },
            now,
          });
        }

        return { id: existing.id, merged: true };
      }
    }

    // ── Auto-pricing (src/server/line-items.ts:361-401) ────────────────────────
    // PER_DAY model-backed line, no manual price → fill from the model's rate using the
    // project's default rental period/quantity. Manual prices are kept.
    let autoUnitPrice = fields.unitPrice;
    let autoDuration = fields.duration;
    // `== null` (not `!unitPrice`) — an EXPLICIT $0 manual price (a free item) is a real
    // choice and must be kept, not overwritten by the model rate. (The server addLineItem
    // has the `!parsed.unitPrice` truthiness bug; this fixes it in the native port.)
    if (fields.modelId && fields.pricingType === "PER_DAY" && fields.unitPrice == null) {
      const [model, proj] = await Promise.all([
        ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", fields.modelId!)).first(),
        ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first(),
      ]);
      if (model && model.organizationId === organizationId) {
        const rentalPeriod = proj?.defaultRentalPeriod ?? "DAILY";
        const rentalQuantity = proj?.defaultRentalQuantity ?? 1;
        const rate =
          rentalPeriod === "WEEKLY"
            ? (model.weeklyRate ?? model.dailyRate ?? null)
            : (model.dailyRate ?? null);
        if (rate != null) {
          autoUnitPrice = Number(rate);
          autoDuration = rentalQuantity;
        }
      }
    }

    const lineTotal = calcLineTotalNative(autoUnitPrice, fields.quantity, autoDuration ?? 1, fields.discount);

    // ── Insert (mirrors createLineItem / addNative) ────────────────────────────
    const dupLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dupLine) throw new ConvexError("Line item already exists");

    const sortOrder = await nextLineSort(ctx, projectId, organizationId);
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId,
      type: fields.type,
      modelId: fields.modelId || undefined,
      assetId: fields.assetId || undefined,
      bulkAssetId: fields.bulkAssetId || undefined,
      description: fields.description || undefined,
      quantity: fields.quantity,
      unitPrice: autoUnitPrice ?? undefined,
      pricingType: fields.pricingType,
      duration: autoDuration ?? undefined,
      discount: fields.discount ?? undefined,
      lineTotal: lineTotal ?? undefined,
      groupName: fields.groupName || undefined,
      notes: fields.notes || undefined,
      isOptional: fields.isOptional,
      showSubhireOnDocs: fields.showSubhireOnDocs,
      supplierId: fields.supplierId || undefined,
      subhireOrderNumber: fields.subhireOrderNumber || undefined,
      categoryId: fields.categoryId || undefined,
      groupId: fields.groupId || undefined,
      status: "CONFIRMED",
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    if (includeAccessories && fields.type === "EQUIPMENT" && (fields.assetId || fields.modelId)) {
      await expandAccessoryChildLines(ctx, {
        id,
        assetId: fields.assetId,
        modelId: fields.modelId,
        quantity: fields.quantity,
        categoryId: fields.categoryId,
        groupId: fields.groupId,
        duration: autoDuration,
        pricingType: fields.pricingType,
        organizationId,
        projectId,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: fields.description || "Line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Added line item to project",
      projectId,
      createdAt: now,
    });

    if (fields.groupId) await recomputeGroupSuggestedNative(ctx, fields.groupId, organizationId, now);
    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);

    // Collab feed + webhook — folded from addLineItem's server tail. On an insert the
    // resulting line is the freshly-created row (parity with the server, which read back
    // the new id). modelId/type/description mirror the stored `|| undefined` normalisation.
    if (emitSideEffects === true) {
      await emitLineItemAdded(ctx, {
        orgId: organizationId,
        actor,
        projectId,
        line: {
          id,
          modelId: fields.modelId ?? null,
          quantity: fields.quantity,
          type: fields.type ?? null,
          description: fields.description ?? null,
        },
        now,
      });
    }

    return { id, merged: false };
  },
});
