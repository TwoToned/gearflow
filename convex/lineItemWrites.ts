import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { assertLineMoneyFields } from "./lib/moneyGuards";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import * as enums from "./lib/validators";
import { expandAccessoryChildLines } from "./lib/fulfillment";
import { createKitLineItemCore, assertProjectInOrg } from "./projectLineItems";
import {
  loadModelAvailabilityBundle,
  computeModelAvailability,
  findAssetConflict,
} from "./lib/availabilityCore";

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
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, orgDefaultTaxRate, actor: suppliedActor, auditId, now }) => {
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
    // to one round-trip; org default tax passed from Postgres, the source of truth).
    await recalcProjectTotals(ctx, line.projectId, orgId, orgDefaultTaxRate, now);
    return { projectId: line.projectId };
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
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    set: v.any(),
    clear: v.array(v.string()),
    entityName: v.string(),
    allowOverbook: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, orgDefaultTaxRate, set, clear, entityName, allowOverbook, actor: suppliedActor, auditId, now }) => {
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

    await recalcProjectTotals(ctx, doc.projectId, orgId, orgDefaultTaxRate, now);
    return { projectId: doc.projectId };
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
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, orgDefaultTaxRate, actor: suppliedActor, auditId, now }) => {
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

    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);
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
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, includeAccessories, allowOverbook, orgDefaultTaxRate, actor: suppliedActor, auditId, now }) => {
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
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, kitLabel, orgDefaultTaxRate, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    // Dup-guard the client-minted kit-line id (by_cuid is global + non-unique).
    const dupKit = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dupKit) throw new ConvexError("Line item already exists");

    await createKitLineItemCore(ctx, {
      id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: kitLabel,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added kit ${kitLabel} to project`,
      projectId,
      kitId,
      createdAt: now,
    });

    await recalcProjectTotals(ctx, projectId, organizationId, orgDefaultTaxRate, now);
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
 * orgDefaultTaxRate is passed by the caller (Postgres — no Convex mirror writer).
 * Gated behind NATIVE_RECALC; parity with the server-side math is proven by
 * convex/recalc.test.ts (recalcProjectTotals, the shared core).
 */
export const recalcNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, { projectId, orgId, orgDefaultTaxRate, now }) => {
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    await recalcProjectTotals(ctx, projectId, orgId, orgDefaultTaxRate, now);
    return { ok: true as const };
  },
});
