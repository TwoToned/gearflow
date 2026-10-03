import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { createKitLineItemCore } from "./projectLineItems";
import { findKitConflict } from "./lib/availabilityCore";
import { getProjectWindow } from "./lib/projectWindow";
import { recalcProjectTotals } from "./lib/recalc";
import { assertRefInOrg } from "./lib/orgRef";
import { getKitByCuid } from "./lib/kits";
import { computeGroupSuggestedPrice } from "./lib/suggestedPrice";
import { inclusiveCalendarDays, computeBlendedCharge, serializePriceBreakdown } from "./lib/billingDerivation";
import { resolveLiveVersionIdForProject, resolveWriteVersionId, versionRows } from "./lib/versionScope";

/**
 * Native GROUP-TEMPLATE write mutations (Phase 3 browser-direct — replaces the
 * saveGroupAsTemplate / updateGroupTemplate / deleteGroupTemplate / applyGroupTemplate
 * server actions in src/server/group-templates.ts). All gate on
 * `project:manage_line_items` (exact parity with the deleted actions'
 * requirePermission("project","manage_line_items")).
 *
 * `applyNative` is the money-adjacent keystone: it creates the target group, expands
 * model + kit template items into priced line items (kits via the SHARED
 * createKitLineItemCore, same code addKitNative runs), recomputes the group's
 * suggested price, and calls the in-mutation recalcProjectTotals — all atomic.
 * Kit availability is a NON-THROWING pre-check (a mid-insert throw in one mutation
 * would orphan partial writes), so an unavailable / double-booked kit is SKIPPED
 * with a warning while the model lines still land (partial-success parity with the
 * server's per-kit try/catch).
 *
 * The requireService mirrors in groupTemplates.ts / groupTemplateItems.ts (backfill)
 * are intentionally UNTOUCHED. `groupTemplateItems.templateId` is a plain string FK
 * (no by_templateId index) — org items are filtered by templateId in JS.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// Parity with src/lib/validations/group-template.ts groupTemplateSchema.
const NAME_MIN = 1;
const NAME_MAX = 200;
const DESC_MAX = 2000;

function assertValidName(name: string) {
  if (name.length < NAME_MIN) throw new ConvexError("Name is required");
  if (name.length > NAME_MAX) throw new ConvexError("Name must be at most 200 characters");
}
function assertValidDescription(description: string | undefined) {
  if (description != null && description.length > DESC_MAX) {
    throw new ConvexError("Description must be at most 2000 characters");
  }
}

// ─── Collaboration colour (deterministic from userId) ────────────────────────
// Inlined from src/lib/collaboration-colors.ts getUserColor (same as
// projectCategoriesWrites.ts) so the collab event applyNative writes is
// byte-identical to the one the server action emitted via writeCollabActivityEvent.
const COLLAB_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#0891b2", "#059669", "#65a30d",
  "#d97706", "#0d9488", "#4f46e5", "#9333ea", "#0284c7", "#16a34a",
] as const;
function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

/** Next sort order for a project's lines in ONE version (replica of the
 *  private nextLineSort). #1221 follow-up: takes an explicit `versionId`
 *  (defaulting to live) instead of always resolving live itself — an applied
 *  template landing on a non-live version must be sorted among THAT
 *  version's own siblings, not live's. */
async function nextLineSort(ctx: MutationCtx, projectId: string, orgId: string, versionId?: string): Promise<number> {
  const targetVersionId = versionId ?? (await resolveLiveVersionIdForProject(ctx, projectId, orgId));
  const top = await ctx.db
    .query("projectLineItems")
    .withIndex("by_versionId_sortOrder", (q) => q.eq("versionId", targetVersionId))
    .order("desc")
    .first();
  return ((top && top.organizationId === orgId ? top.sortOrder : undefined) ?? -1) + 1;
}

/** Fetch a group template by cuid, confirm it's the caller's org (by_cuid is global). */
async function requireTemplateInOrg(ctx: MutationCtx, templateId: string, orgId: string) {
  const tpl = await ctx.db
    .query("groupTemplates")
    .withIndex("by_cuid", (q) => q.eq("id", templateId))
    .first();
  if (!tpl || tpl.organizationId !== orgId) throw new ConvexError("Group template not found");
  return tpl;
}

/** This template's items, sorted by sortOrder. Org-rechecked since by_templateId is global. */
async function listTemplateItems(ctx: MutationCtx, templateId: string, orgId: string) {
  const items = await ctx.db
    .query("groupTemplateItems")
    .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
    .collect();
  return items
    .filter((it) => it.organizationId === orgId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Delete all of this org's items for a template (children-first cascade). */
async function deleteTemplateItems(ctx: MutationCtx, templateId: string, orgId: string) {
  const existing = (
    await ctx.db
      .query("groupTemplateItems")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .collect()
  ).filter((it) => it.organizationId === orgId);
  for (const e of existing) await ctx.db.delete(e._id);
}

async function logTemplateChange(
  ctx: MutationCtx,
  args: {
    orgId: string;
    action: string;
    entityId: string;
    entityName: string;
    summary: string;
    actor: Actor;
    auditId: string;
    now: number;
    projectId?: string;
  },
) {
  await writeActivityLog(ctx, {
    id: args.auditId,
    organizationId: args.orgId,
    action: args.action,
    entityType: args.projectId ? "project" : "group_template",
    entityId: args.entityId,
    entityName: args.entityName,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: args.summary,
    projectId: args.projectId,
    createdAt: args.now,
  });
}

/**
 * saveGroupAsTemplateNative — snapshot a project group's model/kit-backed lines into a
 * new group template. Copies ONLY {modelId, kitId, quantity} from each templatable line
 * (free-text/service lines dropped). CREATE audit. Parity: src/server/group-templates.ts
 * saveGroupAsTemplate (L185).
 */
export const saveGroupAsTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    templateId: v.string(),
    orgId: v.string(),
    groupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { templateId, orgId, groupId, name, description, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "groupTemplate");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);
    assertValidName(name);
    assertValidDescription(description);

    // Idempotent on a retried submit with the same client-minted templateId.
    const dup = await ctx.db.query("groupTemplates").withIndex("by_cuid", (q) => q.eq("id", templateId)).first();
    if (dup) {
      if (dup.organizationId !== orgId) throw new ConvexError("Group template not found");
      return { id: templateId };
    }

    // Group + its (org-scoped) lines.
    const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
    if (!group || group.organizationId !== orgId) throw new ConvexError("Group not found");

    // LIVE-ONLY (#1228).
    const groupProjectVersionId = await resolveLiveVersionIdForProject(ctx, group.projectId, orgId);
    const templatable = (await versionRows(ctx, "projectLineItems", groupProjectVersionId))
      .filter((li) => li.organizationId === orgId && li.groupId === groupId && !li.isKitChild)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      // Only model- or kit-backed lines can be templated (free-text/service dropped).
      .filter((li) => li.modelId != null || li.kitId != null);

    if (templatable.length === 0) {
      throw new ConvexError("Group has no model- or kit-backed items to template");
    }

    await ctx.db.insert("groupTemplates", {
      id: templateId,
      organizationId: orgId,
      name,
      description: description || undefined,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < templatable.length; i++) {
      const li = templatable[i];
      await ctx.db.insert("groupTemplateItems", {
        id: createId(),
        organizationId: orgId,
        templateId,
        modelId: li.modelId ?? undefined,
        kitId: li.kitId ?? undefined,
        quantity: li.quantity ?? 0,
        sortOrder: i,
      });
    }

    await logTemplateChange(ctx, {
      orgId,
      action: "CREATE",
      entityId: templateId,
      entityName: name,
      summary: `Saved group "${group.title ?? groupId}" as template "${name}"`,
      actor,
      auditId,
      now,
    });

    return { id: templateId };
  },
});

/**
 * updateTemplateNative — patch a template's name/description; if `items` is provided,
 * replace ALL child items (children-first cascade delete + re-insert). UPDATE audit.
 * Parity: updateGroupTemplate (L447). Note: `description || undefined` matches the
 * server's non-clearing patch semantics (a "" leaves the old value, like the action).
 */
export const updateTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    templateId: v.string(),
    orgId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          modelId: v.optional(v.string()),
          kitId: v.optional(v.string()),
          quantity: v.number(),
          sortOrder: v.optional(v.number()),
        }),
      ),
    ),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { templateId, orgId, name, description, items, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "groupTemplate");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const existing = await requireTemplateInOrg(ctx, templateId, orgId);
    if (name !== undefined) assertValidName(name);
    if (description !== undefined) assertValidDescription(description);

    const patch: { name?: string; description?: string; updatedAt: number } = { updatedAt: now };
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description || undefined;
    await ctx.db.patch(existing._id, patch);

    if (items !== undefined) {
      // Parity with groupTemplateSchema.shape.items (min 1): a template must keep ≥1 item.
      if (items.length === 0) throw new ConvexError("A template must have at least one item");
      // Validate (parity with groupTemplateItemSchema: one of modelId/kitId, qty 1..9999).
      for (const it of items) {
        if (!!it.modelId === !!it.kitId) {
          throw new ConvexError("Each template item must reference either a model or a kit, not both");
        }
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 9999) {
          throw new ConvexError("Item quantity must be an integer between 1 and 9999");
        }
      }
      // Replace-all (cross-doc, not atomic vs. the parent patch — same as the server).
      await deleteTemplateItems(ctx, templateId, orgId);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await ctx.db.insert("groupTemplateItems", {
          id: createId(),
          organizationId: orgId,
          templateId,
          modelId: it.modelId ?? undefined,
          kitId: it.kitId ?? undefined,
          quantity: it.quantity,
          sortOrder: it.sortOrder ?? i,
        });
      }
    }

    const resolvedName = name !== undefined ? name : existing.name;
    await logTemplateChange(ctx, {
      orgId,
      action: "UPDATE",
      entityId: templateId,
      entityName: resolvedName,
      summary: `Updated group template "${resolvedName}"`,
      actor,
      auditId,
      now,
    });

    return { id: templateId };
  },
});

/**
 * deleteTemplateNative — children-first cascade delete of a template. DELETE audit.
 * Parity: deleteGroupTemplate (L510).
 */
export const deleteTemplateNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    templateId: v.string(),
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { templateId, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "groupTemplate");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const template = await requireTemplateInOrg(ctx, templateId, orgId);

    // Children first, then the parent — a mid-failure leaves (at worst) an empty
    // parent, never orphaned children pointing at a missing template.
    await deleteTemplateItems(ctx, templateId, orgId);
    await ctx.db.delete(template._id);

    await logTemplateChange(ctx, {
      orgId,
      action: "DELETE",
      entityId: templateId,
      entityName: template.name,
      summary: `Deleted group template "${template.name}"`,
      actor,
      auditId,
      now,
    });

    return { ok: true };
  },
});

/**
 * applyNative — materialise a group template into a new project group (THE
 * orchestration). Parity: applyGroupTemplate (L266). Creates the group, expands
 * model + kit items into priced lines, recomputes the group suggested price, and
 * recalcs project totals — atomic. Kit availability is a NON-THROWING pre-check so
 * an unavailable / double-booked kit is skipped (with a warning) rather than
 * aborting the whole apply (partial-success parity with the server per-kit catch).
 * Client mints the group id + one id per model line + one id per kit UNIT (createId
 * fallback guards a template that drifted between the client read and the mutation).
 */
export const applyNative = mutation({
  returns: v.object({ groupId: v.string(), kitWarnings: v.array(v.string()) }),
  args: {
    templateId: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    categoryId: v.optional(v.string()),
    title: v.string(),
    groupId: v.string(),
    modelLineIds: v.array(v.string()),
    kitLineIds: v.array(v.string()),
    // #1221 follow-up (closes Phase 5's Equipment write-side gap, extended to
    // "Add group" → apply-template) — the version the new group + its
    // expanded items land on, defaulting to live when absent. Validated
    // against `project` (same org + project) by resolveWriteVersionId.
    versionId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "groupTemplate");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);
    assertValidName(a.title);

    // Template (org-guard) + its items.
    const template = await requireTemplateInOrg(ctx, a.templateId, a.orgId);
    const templateItems = await listTemplateItems(ctx, a.templateId, a.orgId);

    // Project (org-guard — recalc sweeps by projectId with no org filter, so a
    // foreign project here would corrupt another org's totals).
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
    if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    const targetVersionId = await resolveWriteVersionId(ctx, project, a.versionId);

    // Org-validate the client-supplied categoryId FK (by_cuid is GLOBAL — cross-org refs leak).
    // A group's categoryId references the PROJECT-scoped projectCategories table (same as
    // projectGroupsWrites.createGroupNative + the line-item add paths), NOT the global model
    // catalog `categories` — validating against the wrong table would reject every legit apply.
    if (a.categoryId) await assertRefInOrg(ctx, "projectCategories", a.categoryId, a.orgId);

    // Org default tax rate (Postgres-authoritative mirror; read inline, NOT a client arg).
    const settingsRow = await ctx.db
      .query("orgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))
      .first();
    const orgDefaultTaxRate = settingsRow?.defaultTaxRate ?? null;

    // ── Create the group inline (replicate projectGroups.createAtEnd) ──────────
    // #1221: scoped to the TARGET version (was LIVE-ONLY, #1228).
    const bucket = a.categoryId ?? null;
    const siblings = (await versionRows(ctx, "projectGroups", targetVersionId)).filter(
      (g) => g.organizationId === a.orgId && (g.categoryId ?? null) === bucket,
    );
    const groupSortOrder = siblings.reduce((m, g) => Math.max(m, g.sortOrder ?? -1), -1) + 1;
    // Dup-guard the client-minted group cuid (by_cuid is global + non-unique): a reused id
    // would insert a SECOND row, and the suggested-price patch below re-fetching by_cuid
    // could then hit — and mutate — another org's group. Reject the collision instead.
    const dupGroup = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", a.groupId)).first();
    if (dupGroup) throw new ConvexError("Group already exists");
    // Capture the inserted _id and patch THAT directly later (never re-query by the global cuid).
    const groupDocId = await ctx.db.insert("projectGroups", {
      id: a.groupId,
      organizationId: a.orgId,
      projectId: a.projectId,
      versionId: targetVersionId,
      lineageId: a.groupId,
      categoryId: a.categoryId || undefined,
      title: a.title,
      description: template.description || undefined,
      quantity: 1,
      suggestedPrice: 0,
      sortOrder: groupSortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // Client-minted id pools (createId fallback on drift — createId is tolerated in
    // Convex mutations here, same as createKitLineItemCore's internal child ids).
    let mi = 0;
    const nextModelId = () => a.modelLineIds[mi++] ?? createId();
    let ki = 0;
    const nextKitId = () => a.kitLineIds[ki++] ?? createId();

    // Model cache (resolve each model once; reused by the suggested-price recompute).
    const modelCache = new Map<string, Doc<"models"> | null>();
    const getModel = async (modelId: string): Promise<Doc<"models"> | null> => {
      const cached = modelCache.get(modelId);
      if (cached !== undefined) return cached;
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
      const resolved = m && m.organizationId === a.orgId ? m : null;
      modelCache.set(modelId, resolved);
      return resolved;
    };

    // ── Model items → bare model lines (no accessory expansion) ────────────────
    // #943: blended per-unit charge (best-price capped) over the project's
    // rental window, replacing the old defaultRentalPeriod-branched rate pick.
    // duration pinned to 1 — the blended charge already bakes in the whole
    // chargeable window (lineTotal = unitPrice × qty × duration stays untouched).
    const chargeableDays = inclusiveCalendarDays(project.rentalStartDate, project.rentalEndDate);
    for (const item of templateItems) {
      if (!item.modelId) continue;
      const model = await getModel(item.modelId);
      if (!model) continue; // parity: server dropped items whose model didn't resolve
      const quantity = item.quantity ?? 1;
      // #1249 — the SAME rate guard `addLineItemSmartNative` applies before it
      // auto-prices. computeBlendedCharge with both rates null returns
      // `(dailyRate ?? 0) * totalDays` = 0, so applying a template used to write
      // an explicit $0 (plus a priceBreakdown that made it look auto-priced) for
      // every model with no daily/weekly rate — indistinguishable from a
      // deliberately free line, and inside a priced group that gear then
      // reported $0 ROI. No rate to price from means NO price: the line lands
      // unpriced ("—"), which is what allocation and the Unpriced badge expect.
      const hasRate = model.dailyRate != null || model.weeklyRate != null;
      const priced = hasRate
        ? computeBlendedCharge({
            chargeableDays,
            dailyRate: model.dailyRate ?? null,
            weeklyRate: model.weeklyRate ?? null,
          })
        : null;
      const sortOrder = await nextLineSort(ctx, a.projectId, a.orgId, targetVersionId);
      const modelLineId = nextModelId();
      // Dup-guard the client-minted line cuid (by_cuid is global + non-unique).
      const dupLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", modelLineId)).first();
      if (dupLine) throw new ConvexError("Line item already exists");
      await ctx.db.insert("projectLineItems", {
        id: modelLineId,
        organizationId: a.orgId,
        projectId: a.projectId,
        versionId: targetVersionId,
        lineageId: modelLineId,
        categoryId: a.categoryId || undefined,
        groupId: a.groupId,
        modelId: item.modelId,
        description: model.name,
        quantity,
        unitPrice: priced?.perUnitCharge,
        duration: 1,
        priceBreakdown: priced ? serializePriceBreakdown(priced.breakdown) : undefined,
        lineTotal: priced ? priced.perUnitCharge * quantity : undefined,
        status: "CONFIRMED",
        sortOrder,
        createdAt: a.now,
        updatedAt: a.now,
      });
    }

    // ── Kit items → expand via the shared core, with a NON-THROWING pre-check ──
    const kitWarnings: string[] = [];
    // Gear-committed window, not raw rental dates — see project-window.ts.
    const { start: kitTemplateWinStart, end: kitTemplateWinEnd } = getProjectWindow(project);
    const hasDates = kitTemplateWinStart != null && kitTemplateWinEnd != null;
    for (const item of templateItems) {
      if (!item.kitId) continue;
      const kitId = item.kitId; // hoist so the narrowing survives the closure below
      const kit = await getKitByCuid(ctx, kitId);
      const label = kit?.assetTag ?? kitId;
      if (!kit || kit.organizationId !== a.orgId) {
        kitWarnings.push(`${label}: kit not found`);
        continue;
      }
      if (kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") {
        kitWarnings.push(`${label}: kit is ${kit.status.replace("_", " ").toLowerCase()}`);
        continue;
      }
      if (hasDates) {
        const conflict = await findKitConflict(ctx, {
          kitId,
          orgId: a.orgId,
          excludeProjectId: a.projectId,
          rentalStart: kitTemplateWinStart!,
          rentalEnd: kitTemplateWinEnd!,
        });
        if (conflict) {
          kitWarnings.push(
            `${label}: already booked on ${conflict.projectNumber ?? conflict.id} during those dates`,
          );
          continue;
        }
      }
      // All checks passed — one parent kit line per unit of quantity.
      // The non-throwing pre-check above covers the EXPECTED skip cases (not-found /
      // maintenance / booking conflict) with partial-success parity. createKitLineItemCore
      // may still throw on a genuinely UNEXPECTED error (malformed member ref, Convex write
      // limit on a huge quantity) — that aborts the WHOLE apply (atomic all-or-nothing).
      // This differs from the deleted server action, which ran each kit as its own mutation
      // and kept the model lines; here an unexpected failure surfaces cleanly instead of
      // half-applying the template. Realistic template quantities are small.
      const quantity = item.quantity ?? 1;
      for (let u = 0; u < quantity; u++) {
        const kitLineId = nextKitId();
        const dupKit = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", kitLineId)).first();
        if (dupKit) throw new ConvexError("Line item already exists");
        await createKitLineItemCore(ctx, {
          id: kitLineId,
          organizationId: a.orgId,
          projectId: a.projectId,
          kitId,
          pricingMode: "ITEMIZED",
          categoryId: a.categoryId || undefined,
          groupId: a.groupId,
          versionId: targetVersionId,
          now: a.now,
        });
      }
    }

    // ── Suggested price recompute — the SHARED computeGroupSuggestedPrice port
    // (convex/lib/suggestedPrice.ts). This used to be a fourth hand-duplicated
    // copy of the formula; #943 collapses it into the one canonical helper every
    // other call site already uses (recomputeGroupSuggestedNative in
    // lineItemWrites.ts, recomputeGroupSuggestedById in projectGroupsWrites.ts,
    // subHireLineGen.ts).
    const suggested = await computeGroupSuggestedPrice(ctx, {
      projectId: a.projectId,
      groupId: a.groupId,
      orgId: a.orgId,
      rentalStartDate: project.rentalStartDate,
      rentalEndDate: project.rentalEndDate,
    });
    // Patch the group we just inserted by its _id — never re-query by the global cuid.
    await ctx.db.patch(groupDocId, { suggestedPrice: suggested, updatedAt: a.now });

    // ── Totals recalc (always — idempotent + correct) ──────────────────────────
    await recalcProjectTotals(ctx, a.projectId, a.orgId, orgDefaultTaxRate, a.now);

    // ── Audit + collaboration feed event ───────────────────────────────────────
    const n = templateItems.length;
    const summary =
      kitWarnings.length > 0
        ? `Applied template "${template.name}" as group "${a.title}" with ${n} item(s); skipped ${kitWarnings.length} kit item(s): ${kitWarnings.join("; ")}`
        : `Applied template "${template.name}" as group "${a.title}" with ${n} item(s)`;
    await logTemplateChange(ctx, {
      orgId: a.orgId,
      action: "CREATE",
      entityId: a.projectId,
      entityName: a.title,
      summary,
      actor,
      auditId: a.auditId,
      now: a.now,
      projectId: a.projectId,
    });

    await ctx.db.insert("activityEvents", {
      orgId: a.orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: getUserColor(actor.userId),
      entityType: "project",
      entityId: a.projectId,
      targetType: "group",
      targetId: a.groupId,
      action: "template_applied",
      summary: `imported ${n} item${n === 1 ? "" : "s"} from template "${template.name}" into "${a.title}"`,
      createdAt: a.now,
    });

    return { groupId: a.groupId, kitWarnings };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  saveGroupAsTemplateNative: { danger: "medium" },
  updateTemplateNative: { danger: "medium" },
  // Delete = high (§9), same categorical rule as every other module.
  deleteTemplateNative: { danger: "high" },
  // Books real kit/model line items + recalcs project totals, same effect class as
  // addKitNative/addLineItemSmartNative in lineItemWrites.ts — an ordinary, recoverable
  // create, not a stock-affecting or irreversible action.
  applyNative: { danger: "medium" },
};
