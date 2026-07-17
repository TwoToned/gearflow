import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { createKitLineItemCore } from "./projectLineItems";
import { findKitConflict } from "./lib/availabilityCore";
import { recalcProjectTotals } from "./lib/recalc";
import { assertRefInOrg } from "./lib/orgRef";

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

const round = (n: number): number => Math.round(n * 100) / 100;

/** Next sort order for a project's lines (replica of the private nextLineSort). */
async function nextLineSort(ctx: MutationCtx, projectId: string, orgId: string): Promise<number> {
  const top = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_sortOrder", (q) => q.eq("projectId", projectId))
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

/** This template's items (by_organizationId, then filter by templateId in JS — no
 *  by_templateId index), sorted by sortOrder. */
async function listTemplateItems(ctx: MutationCtx, templateId: string, orgId: string) {
  const all = await ctx.db
    .query("groupTemplateItems")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .collect();
  return all
    .filter((it) => it.templateId === templateId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Delete all of this org's items for a template (children-first cascade). */
async function deleteTemplateItems(ctx: MutationCtx, templateId: string, orgId: string) {
  const existing = (
    await ctx.db
      .query("groupTemplateItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect()
  ).filter((it) => it.templateId === templateId);
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

    const templatable = (
      await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", group.projectId))
        .collect()
    )
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

    const defaultRentalPeriod = project.defaultRentalPeriod ?? undefined;
    const defaultRentalQuantity = project.defaultRentalQuantity ?? undefined;

    // ── Create the group inline (replicate projectGroups.createAtEnd) ──────────
    const bucket = a.categoryId ?? null;
    const siblings = (
      await ctx.db
        .query("projectGroups")
        .withIndex("by_projectId", (q) => q.eq("projectId", a.projectId))
        .collect()
    ).filter((g) => g.organizationId === a.orgId && (g.categoryId ?? null) === bucket);
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
      categoryId: a.categoryId || undefined,
      title: a.title,
      description: template.description || undefined,
      quantity: 1,
      rentalPeriod: defaultRentalPeriod,
      rentalQuantity: defaultRentalQuantity,
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
    const period = project.defaultRentalPeriod ?? "DAILY";
    for (const item of templateItems) {
      if (!item.modelId) continue;
      const model = await getModel(item.modelId);
      if (!model) continue; // parity: server dropped items whose model didn't resolve
      const quantity = item.quantity ?? 1;
      const rate =
        period === "WEEKLY"
          ? Number(model.weeklyRate ?? model.dailyRate ?? 0)
          : Number(model.dailyRate ?? 0);
      const sortOrder = await nextLineSort(ctx, a.projectId, a.orgId);
      const modelLineId = nextModelId();
      // Dup-guard the client-minted line cuid (by_cuid is global + non-unique).
      const dupLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", modelLineId)).first();
      if (dupLine) throw new ConvexError("Line item already exists");
      await ctx.db.insert("projectLineItems", {
        id: modelLineId,
        organizationId: a.orgId,
        projectId: a.projectId,
        categoryId: a.categoryId || undefined,
        groupId: a.groupId,
        modelId: item.modelId,
        description: model.name,
        quantity,
        unitPrice: rate,
        lineTotal: rate * quantity,
        status: "CONFIRMED",
        sortOrder,
        createdAt: a.now,
        updatedAt: a.now,
      });
    }

    // ── Kit items → expand via the shared core, with a NON-THROWING pre-check ──
    const kitWarnings: string[] = [];
    const hasDates = project.rentalStartDate != null && project.rentalEndDate != null;
    for (const item of templateItems) {
      if (!item.kitId) continue;
      const kitId = item.kitId; // hoist so the narrowing survives the closure below
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
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
          rentalStart: project.rentalStartDate!,
          rentalEnd: project.rentalEndDate!,
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
          now: a.now,
        });
      }
    }

    // ── Suggested price recompute (port of calculateSuggestedPrice L29-64) ─────
    const rentalPeriod = defaultRentalPeriod ?? "DAILY";
    const rentalQuantity = defaultRentalQuantity ?? 1;
    const groupLines = (
      await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", a.projectId))
        .collect()
    ).filter((li) => li.organizationId === a.orgId && li.groupId === a.groupId && !li.isKitChild);
    let suggested = 0;
    for (const li of groupLines) {
      if (li.isCustomItem) continue;
      const model = li.modelId ? await getModel(li.modelId) : null;
      const rate =
        rentalPeriod === "WEEKLY"
          ? Number(model?.weeklyRate ?? model?.dailyRate ?? li.unitPrice ?? 0)
          : Number(model?.dailyRate ?? li.unitPrice ?? 0);
      suggested += rate * (li.quantity ?? 0) * rentalQuantity;
    }
    // Patch the group we just inserted by its _id — never re-query by the global cuid.
    await ctx.db.patch(groupDocId, { suggestedPrice: round(suggested), updatedAt: a.now });

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
