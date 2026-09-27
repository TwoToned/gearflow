import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertStrLen, assertArrayMax } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { assertRefInOrg } from "./lib/orgRef";
import { assertProjectInOrg } from "./projectLineItems";
import * as enums from "./lib/validators";
import { resolveWriteVersionId, versionRows } from "./lib/versionScope";

/**
 * Native ProjectContainer write mutations (#1296 packing containers, build
 * plan phase 1b). Reads live in `projectContainers.ts`. Containers are never
 * priced (D5) — no lock/money gate anywhere here; every write is structural,
 * same allowance an unpriced line-item add gets (Q16).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const LABEL_MAX = 120; // src/lib/validations/project-container.ts
const DESCRIPTION_MAX = 500;
const MAX_UNIT_IDS = 500;
const MAX_CYCLE_DEPTH = 64; // generous ceiling on nesting depth walked by the cycle check

/** Fetch a project by cuid, confirm it's the caller's org. */
async function requireProjectForGuard(ctx: MutationCtx, projectId: string, orgId: string) {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  return p;
}

/** Fetch a container by cuid and confirm it belongs to the caller's org (by_cuid is global). */
async function requireContainerInOrg(ctx: MutationCtx, containerId: string, orgId: string) {
  const c = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", containerId)).first();
  if (!c || c.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Container not found." });
  return c;
}

async function logContainerChange(
  ctx: MutationCtx,
  args: {
    orgId: string;
    projectId: string;
    actor: Actor;
    auditId: string;
    now: number;
    action: string;
    entityId: string;
    entityName: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  await writeActivityLog(ctx, {
    id: args.auditId,
    organizationId: args.orgId,
    action: args.action,
    entityType: "projectContainer",
    entityId: args.entityId,
    projectId: args.projectId,
    entityName: args.entityName,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: args.summary,
    metadata: args.metadata,
    createdAt: args.now,
  });
}

/** Next sort order for a project's containers in ONE version. Collect + reduce
 *  (no dedicated `by_versionId_sortOrder` index) — bounded by the version's
 *  container count, which stays small even on a heavily-packed job. */
async function nextContainerSort(ctx: MutationCtx, versionId: string, organizationId: string): Promise<number> {
  const siblings = (await versionRows(ctx, "projectContainers", versionId)).filter((c) => c.organizationId === organizationId);
  return siblings.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1;
}

/** Next sort order for a project's LINE ITEMS in ONE version (mirrors the
 *  private helper of the same name in lineItemWrites.ts/projectLineItems.ts —
 *  desc-first on the composite index instead of collecting every line). */
async function nextLineSort(ctx: MutationCtx, versionId: string, organizationId: string): Promise<number> {
  const top = await ctx.db
    .query("projectLineItems")
    .withIndex("by_versionId_sortOrder", (q) => q.eq("versionId", versionId))
    .order("desc")
    .first();
  return ((top && top.organizationId === organizationId ? top.sortOrder : undefined) ?? -1) + 1;
}

/** Walk `startId`'s parent chain; throw if `target` (the container being
 *  reparented) appears in it — that would make it its own ancestor. */
async function assertNoParentCycle(
  ctx: MutationCtx,
  target: string,
  startParentId: string,
  orgId: string,
): Promise<void> {
  let cursor: string | undefined = startParentId;
  let depth = 0;
  while (cursor) {
    if (cursor === target) {
      throw new ConvexError({ code: "CYCLE", message: "A container can't be packed inside itself (directly or via nesting)." });
    }
    if (++depth > MAX_CYCLE_DEPTH) {
      throw new ConvexError({ code: "CYCLE", message: "Container nesting is too deep to resolve." });
    }
    const parent = await requireContainerInOrg(ctx, cursor, orgId);
    cursor = parent.parentContainerId;
  }
}

/** The two kind-specific "you must pick one" guards — split out of
 *  `createNative`'s handler to keep its branching under the complexity
 *  ratchet (R-3.6). */
function assertValidContainerKindInputs(kind: string, assetId: string | undefined, bulkAssetId: string | undefined): void {
  if (kind === "ASSET" && !assetId) throw new ConvexError({ code: "INVALID_FIELD", message: "An asset must be selected for an ASSET container." });
  if (kind === "BULK_ASSET" && !bulkAssetId) throw new ConvexError({ code: "INVALID_FIELD", message: "A bulk asset must be selected for a BULK_ASSET container." });
}

async function assertContainerRefsInOrg(
  ctx: MutationCtx,
  orgId: string,
  refs: { assetId?: string; bulkAssetId?: string; modelId?: string },
): Promise<void> {
  if (refs.assetId) await assertRefInOrg(ctx, "assets", refs.assetId, orgId);
  if (refs.bulkAssetId) await assertRefInOrg(ctx, "bulkAssets", refs.bulkAssetId, orgId);
  if (refs.modelId) await assertRefInOrg(ctx, "models", refs.modelId, orgId);
}

async function assertParentContainerOnSameProject(
  ctx: MutationCtx,
  parentContainerId: string | undefined,
  projectId: string,
  orgId: string,
): Promise<void> {
  if (!parentContainerId) return;
  const parent = await requireContainerInOrg(ctx, parentContainerId, orgId);
  if (parent.projectId !== projectId) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "A container can only be packed inside a container on the same job." });
  }
}

/** The kind-derived fields shared by both inserts (the container's own line
 *  item and the container row itself) — computed once rather than repeating
 *  the same four ternaries twice. */
function deriveContainerKindFields(
  kind: "ASSET" | "BULK_ASSET" | "CUSTOM",
  assetId: string | undefined,
  bulkAssetId: string | undefined,
  label: string,
): { assetId?: string; bulkAssetId?: string; isCustomItem?: true; description?: string } {
  return {
    assetId: kind === "ASSET" ? assetId : undefined,
    bulkAssetId: kind === "BULK_ASSET" ? bulkAssetId : undefined,
    isCustomItem: kind === "CUSTOM" ? true : undefined,
    description: kind === "CUSTOM" ? label : undefined,
  };
}

/** Delete a container's own units + line item (mirrors lineItemWrites.ts's
 *  `deleteLineWithUnits` — a container's line item is a real line item, so it
 *  can carry its own prep units if it was ever packed/checked out itself). */
async function deleteContainerLineWithUnits(ctx: MutationCtx, lineItemId: string, orgId: string): Promise<void> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!line || line.organizationId !== orgId) return;
  const units = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).collect())
    .filter((u) => u.organizationId === orgId);
  for (const u of units) await ctx.db.delete(u._id);
  await ctx.db.delete(line._id);
}

export const createNative = mutation({
  returns: v.object({ id: v.string(), lineItemId: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    kind: enums.ContainerKind,
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    label: v.string(),
    description: v.optional(v.string()),
    parentContainerId: v.optional(v.string()),
    modelId: v.optional(v.string()), // ASSET/BULK_ASSET only — stamped on the minted line item
    versionId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, projectId, kind, assetId, bulkAssetId, label, description, parentContainerId, modelId, versionId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    assertStrLen(label, "label", { min: 1, max: LABEL_MAX });
    assertStrLen(description, "description", { max: DESCRIPTION_MAX });
    assertValidContainerKindInputs(kind, assetId, bulkAssetId);

    await assertProjectInOrg(ctx, projectId, orgId);
    const project = await requireProjectForGuard(ctx, projectId, orgId);
    // Creating a container is structural — never gated (D5: never priced).
    const targetVersionId = await resolveWriteVersionId(ctx, project, versionId);

    await assertContainerRefsInOrg(ctx, orgId, { assetId, bulkAssetId, modelId });
    await assertParentContainerOnSameProject(ctx, parentContainerId, projectId, orgId);

    // Idempotent on a retried create with the same client-minted cuid.
    const existing = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (existing) {
      if (existing.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Container not found." });
      return { id, lineItemId: existing.lineItemId };
    }

    const kindFields = deriveContainerKindFields(kind, assetId, bulkAssetId, label);
    const lineItemId = createId();
    const lineSort = await nextLineSort(ctx, targetVersionId, orgId);
    await ctx.db.insert("projectLineItems", {
      id: lineItemId,
      organizationId: orgId,
      projectId,
      versionId: targetVersionId,
      lineageId: lineItemId,
      type: "EQUIPMENT",
      modelId,
      assetId: kindFields.assetId,
      bulkAssetId: kindFields.bulkAssetId,
      isCustomItem: kindFields.isCustomItem,
      description: kindFields.description,
      quantity: 1,
      sortOrder: lineSort,
      status: "CONFIRMED",
      checkedOutQuantity: 0,
      prepStatus: "PACKED",
      prepContainer: label, // widen — stays readable for anything not yet migrated to containerId
      containerId: id,
      isContainerLineItem: true,
      createdAt: now,
      updatedAt: now,
    });

    const containerSort = await nextContainerSort(ctx, targetVersionId, orgId);
    await ctx.db.insert("projectContainers", {
      id,
      organizationId: orgId,
      projectId,
      versionId: targetVersionId,
      lineageId: id,
      kind,
      assetId: kindFields.assetId,
      bulkAssetId: kindFields.bulkAssetId,
      label,
      description,
      lineItemId,
      parentContainerId,
      sortOrder: containerSort,
      createdAt: now,
      updatedAt: now,
    });

    await logContainerChange(ctx, {
      orgId, projectId, actor, auditId, now,
      action: "CREATE", entityId: id, entityName: label,
      summary: `Created container "${label}"`,
    });

    return { id, lineItemId };
  },
});

async function assertParentContainerReparentValid(
  ctx: MutationCtx,
  id: string,
  parentContainerId: string | null | undefined,
  currentProjectId: string,
  orgId: string,
): Promise<void> {
  if (parentContainerId === undefined || parentContainerId === null) return;
  if (parentContainerId === id) {
    throw new ConvexError({ code: "CYCLE", message: "A container can't be packed inside itself." });
  }
  const parent = await requireContainerInOrg(ctx, parentContainerId, orgId);
  if (parent.projectId !== currentProjectId) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "A container can only be packed inside a container on the same job." });
  }
  await assertNoParentCycle(ctx, id, parentContainerId, orgId);
}

function buildContainerUpdatePatch(
  label: string | undefined,
  description: string | null | undefined,
  parentContainerId: string | null | undefined,
  now: number,
): { label?: string; description?: string; parentContainerId?: string; updatedAt: number } {
  const patch: { label?: string; description?: string; parentContainerId?: string; updatedAt: number } = { updatedAt: now };
  if (label !== undefined) patch.label = label;
  if (description !== undefined) patch.description = description ?? undefined;
  if (parentContainerId !== undefined) patch.parentContainerId = parentContainerId ?? undefined;
  return patch;
}

/** Keep the container's own line item's label in sync — it's the widen-step
 *  fallback (`prepContainer`) other not-yet-migrated readers still use. */
async function syncContainerLineLabel(
  ctx: MutationCtx,
  container: { lineItemId: string },
  label: string,
  now: number,
  orgId: string,
): Promise<void> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", container.lineItemId)).first();
  if (!line || line.organizationId !== orgId) return;
  await ctx.db.patch(line._id, {
    prepContainer: label,
    ...(line.isCustomItem ? { description: label } : {}),
    updatedAt: now,
  });
}

function describeReparentSummary(label: string, parentContainerId: string | null | undefined): string {
  return parentContainerId
    ? `Packed container "${label}" into another container`
    : `Unpacked container "${label}" to the top level`;
}

export const updateNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    label: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    parentContainerId: v.optional(v.union(v.string(), v.null())),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, label, description, parentContainerId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const container = await requireContainerInOrg(ctx, id, orgId);
    if (label !== undefined) assertStrLen(label, "label", { min: 1, max: LABEL_MAX });
    if (description) assertStrLen(description, "description", { max: DESCRIPTION_MAX });

    await assertParentContainerReparentValid(ctx, id, parentContainerId, container.projectId, orgId);

    const patch = buildContainerUpdatePatch(label, description, parentContainerId, now);
    await ctx.db.patch(container._id, patch);

    if (label !== undefined) await syncContainerLineLabel(ctx, container, label, now, orgId);

    // Label/description edits are metadata, not a physical change — no audit
    // row (parity with projectCategoriesWrites.ts's rename). A parent change
    // physically moves the whole box, so it IS audited.
    if (parentContainerId !== undefined) {
      await logContainerChange(ctx, {
        orgId, projectId: container.projectId, actor, auditId, now,
        action: "UPDATE", entityId: id, entityName: container.label,
        summary: describeReparentSummary(container.label, parentContainerId),
      });
    }

    return { ok: true };
  },
});

export const deleteNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, { id, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const container = await requireContainerInOrg(ctx, id, orgId);

    const memberUnit = (await ctx.db.query("projectLineItemUnits").withIndex("by_containerId", (q) => q.eq("containerId", id)).collect())
      .find((u) => u.organizationId === orgId && u.status !== "CANCELLED");
    if (memberUnit) {
      throw new ConvexError({ code: "NOT_EMPTY", message: "This container still has items packed inside it — move or unpack them first." });
    }
    const childContainer = (await ctx.db.query("projectContainers").withIndex("by_parentContainerId", (q) => q.eq("parentContainerId", id)).collect())
      .find((c) => c.organizationId === orgId);
    if (childContainer) {
      throw new ConvexError({ code: "NOT_EMPTY", message: "This container still has another container packed inside it — move it out first." });
    }

    await deleteContainerLineWithUnits(ctx, container.lineItemId, orgId);
    await ctx.db.delete(container._id);

    await logContainerChange(ctx, {
      orgId, projectId: container.projectId, actor, auditId, now,
      action: "DELETE", entityId: id, entityName: container.label,
      summary: `Deleted container "${container.label}"`,
    });

    return { ok: true };
  },
});

/** Move (or un-pack, with `toContainerId: null`) a batch of units into a
 *  different container in ONE atomic mutation. The missing operation behind
 *  the old "clear + re-prep is the only path" defect (design §1.5 #7). */
async function moveUnitsToContainer(
  ctx: MutationCtx,
  unitIds: string[],
  toContainerId: string | null,
  orgId: string,
  now: number,
): Promise<{ moved: number; projectId?: string }> {
  let moved = 0;
  let projectId: string | undefined;
  for (const unitId of unitIds) {
    const unit = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", unitId)).first();
    if (!unit || unit.organizationId !== orgId) continue; // missing/cross-org — skipped, never moved
    await ctx.db.patch(unit._id, { containerId: toContainerId ?? undefined, updatedAt: now });
    moved++;
    if (projectId) continue;
    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", unit.lineItemId)).first();
    projectId = line?.projectId;
  }
  return { moved, projectId };
}

function describeMoveSummary(moved: number, targetLabel: string | undefined): string {
  const suffix = moved === 1 ? "" : "s";
  return targetLabel
    ? `Moved ${moved} unit${suffix} into container "${targetLabel}"`
    : `Moved ${moved} unit${suffix} to Loose`;
}

export const moveUnitsNative = mutation({
  returns: v.object({ moved: v.number() }),
  args: {
    orgId: v.string(),
    unitIds: v.array(v.string()),
    toContainerId: v.union(v.string(), v.null()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { orgId, unitIds, toContainerId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, unitIds.length);
    assertArrayMax(unitIds, "unitIds", MAX_UNIT_IDS);
    await requireOrgPermission(ctx, orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, suppliedActor);

    const target = toContainerId ? await requireContainerInOrg(ctx, toContainerId, orgId) : null;
    const { moved, projectId } = await moveUnitsToContainer(ctx, unitIds, toContainerId, orgId, now);

    if (moved > 0 && projectId) {
      await logContainerChange(ctx, {
        orgId, projectId, actor, auditId, now,
        action: "UPDATE",
        entityId: toContainerId ?? "loose",
        entityName: target?.label ?? "Loose",
        summary: describeMoveSummary(moved, target?.label),
      });
    }

    return { moved };
  },
});

/** Empty a container's contents to Loose (replaces `clearPrepContainer`'s job
 *  for anything migrated onto `containerId`). */
export const unpackNative = mutation({
  returns: v.object({ unpacked: v.number() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, { id, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, suppliedActor);

    const container = await requireContainerInOrg(ctx, id, orgId);
    const units = (await ctx.db.query("projectLineItemUnits").withIndex("by_containerId", (q) => q.eq("containerId", id)).collect())
      .filter((u) => u.organizationId === orgId);
    for (const u of units) await ctx.db.patch(u._id, { containerId: undefined, updatedAt: now });

    if (units.length > 0) {
      await logContainerChange(ctx, {
        orgId, projectId: container.projectId, actor, auditId, now,
        action: "UPDATE", entityId: id, entityName: container.label,
        summary: `Unpacked ${units.length} item${units.length === 1 ? "" : "s"} from container "${container.label}" to Loose`,
      });
    }

    return { unpacked: units.length };
  },
});

/** Set (or clear, with `containerId: null`) the PM's planned container for a
 *  batch of whole lines (D9 — Packing tab, phase 4). Metadata only: no audit
 *  (parity with a label edit — nothing physical has moved yet). */
export const setPlannedContainerNative = mutation({
  returns: v.object({ updated: v.number() }),
  args: {
    orgId: v.string(),
    lineItemIds: v.array(v.string()),
    containerId: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, { orgId, lineItemIds, containerId, now }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    assertArrayMax(lineItemIds, "lineItemIds", MAX_UNIT_IDS);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");

    if (containerId) await requireContainerInOrg(ctx, containerId, orgId);

    let updated = 0;
    for (const lineItemId of lineItemIds) {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
      if (!line || line.organizationId !== orgId) continue; // missing/cross-org — skipped
      await ctx.db.patch(line._id, { plannedContainerId: containerId ?? undefined, updatedAt: now });
      updated++;
    }
    return { updated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  createNative: { summary: "Create a packing container (case, tub, or custom box) and its own line item on the job.", danger: "low", mcpTier: 2 },
  updateNative: { summary: "Rename, re-describe, or re-nest a packing container.", danger: "low", mcpTier: 3 },
  // Delete family — the API dispatcher's confirm:true gate applies.
  deleteNative: { summary: "Delete an empty packing container and its line item.", danger: "high", mcpTier: 3 },
  moveUnitsNative: { summary: "Move packed units into a different container (or to Loose).", danger: "medium", mcpTier: 2 },
  unpackNative: { summary: "Empty a container's contents to Loose.", danger: "medium", mcpTier: 2 },
  setPlannedContainerNative: { summary: "Set or clear the planned container for a batch of lines (Packing tab).", danger: "low", mcpTier: 3 },
};
