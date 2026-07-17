import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { reserveProjectNumberCounter } from "./lib/projectNumberCounter";
import { renderProjectNumber, scopeKeyFor } from "./lib/projectNumber";
import { recalcProjectTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { assertProjectMoneyFields } from "./lib/moneyGuards";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertNoBlockingCommentsInMutation } from "./lib/blockingCommentsGate";
import { enqueueWebhookEvent } from "./lib/webhookEnqueue";

/** Forward status transitions that a project's open BLOCKING comments must gate
 *  (parity with src/server/projects.ts BLOCKED_FORWARD_PROJECT_STATUSES). */
const BLOCKED_FORWARD_STATUSES = new Set(["PREPPING", "CHECKED_OUT", "ON_SITE"]);
const blockedForwardLabel = (status: string): string =>
  `move this project to ${status.toLowerCase().replaceAll("_", " ")}`;
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { bumpProjectCounters } from "./lib/counters";
import * as enums from "./lib/validators";
import { projectWriteFields } from "./projects";
import { setAssetsStatus } from "./warehouseOps";
import { removeLineItemCascadeCore } from "./projectLineItems";
import { deleteCrewAssignmentCascadeCore } from "./crewAssignments";
import { deleteAllForProjectCore } from "./projectCategories";

/**
 * Native PROJECT write mutations (Phase 5) — the MONEY-FREE project writes only:
 * status change, notes, archive. Each does RBAC(requireOrgPermission "project",
 * "update") + invariant + atomic audit in one transaction.
 *
 * The financial writes (createProject/updateProject and every line-item write) call
 * recalculateProjectTotals and are deliberately NOT here — those stay server-side so
 * the totals math is untouched (parity preserved by construction) until they get the
 * dedicated recalc-parity treatment. Gated behind NATIVE_PROJECT_WRITES.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Resolved auto project-number config, passed by the caller (the format/reset/
 *  padding originate in Postgres `organization.metadata`, which has no Convex
 *  mirror, and `parts` are computed in the org timezone server-side). When
 *  present + `projectNumber` is omitted, createNative allocates the number
 *  in-mutation (scopeKey → reserve sequence → render → clash-guard → retry). */
const autoNumberValidator = v.object({
  format: v.string(),
  reset: v.union(v.literal("NONE"), v.literal("YEARLY"), v.literal("MONTHLY"), v.literal("DAILY")),
  padding: v.number(),
  parts: v.object({ year: v.number(), month: v.number(), day: v.number() }),
});
const NOTES_FIELD = v.union(
  v.literal("crewNotes"),
  v.literal("internalNotes"),
  v.literal("clientNotes"),
);

export const updateStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    status: enums.ProjectStatus,
    actor: actorValidator,
    auditId: v.string(),
    // Gate for the folded `project.status_changed` webhook. OPTIONAL + only honored
    // when `=== true`, so the pre-fold app image (never passes it) does NOT double-emit
    // — its own server tail still emits during the deploy window; the new app/browser
    // passes emitSideEffects:true once its tail is gated off by `!nativeProjectWrites()`.
    // Expand-contract (mirrors convex/lineItemWrites.ts).
    emitSideEffects: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, status, actor: suppliedActor, auditId, emitSideEffects, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_STATUS", message: "Templates don't have a status." });
    }

    const from = project.status ?? "";
    // Open blocking comments gate a FORWARD move into PREPPING/CHECKED_OUT/ON_SITE (parity
    // with the deleted server action). Only on an actual status change (template excluded above).
    if (from !== status && BLOCKED_FORWARD_STATUSES.has(status)) {
      await assertNoBlockingCommentsInMutation(ctx, orgId, id, { actionLabel: blockedForwardLabel(status) });
    }
    await ctx.db.patch(project._id, { status, updatedAt: now });
    await bumpProjectCounters(ctx, orgId, project, { ...project, status });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "STATUS_CHANGE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Changed project ${project.projectNumber} status from ${from} to ${status}`,
      details: { changes: [{ field: "status", from, to: status }] },
      projectId: id,
      createdAt: now,
    });

    // Fired only on an actual status change (folded from the server tail's
    // `emitWebhookEvent("project.status_changed")`, now in the same transaction).
    // Best-effort: a webhook read/insert failure must never roll back the status write.
    if (emitSideEffects === true && from !== status) {
      try {
        await enqueueWebhookEvent(ctx, orgId, "project.status_changed", {
          projectId: id,
          projectNumber: project.projectNumber,
          name: project.name,
          from,
          to: status,
        }, now);
      } catch {
        // swallow — mirrors src/server/projects.ts `void emitWebhookEvent(...)`.
      }
    }

    return { id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    field: NOTES_FIELD,
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, field, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // `undefined` clears the field (matches the server action's notes || null).
    await ctx.db.patch(project._id, { [field]: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated ${field} on project ${project.projectNumber}`,
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(project._id, { status: "CANCELLED", updatedAt: now });
    await bumpProjectCounters(ctx, orgId, project, { ...project, status: "CANCELLED" });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Archived project ${project.projectNumber}`,
      details: { archived: true },
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * The recalc-OWNED money totals. They are derived from the full line-item/service/
 * sub-hire/assignment set by `recalcProjectTotals` (convex/lib/recalc.ts) and must NEVER
 * come from a client — a browser-direct caller could otherwise `set:{ total:0, margin:1e9 }`
 * and forge the project's financials. The legit server path never sends these (createProject
 * omits them; updateProject builds a Zod-validated set with no totals), so stripping is
 * non-breaking. `taxRate`/`discountPercent` are recalc INPUTS and stay settable.
 */
const PROJECT_MONEY_ANCHORS = [
  "equipmentRevenue", "serviceCostTotal", "labourCostTotal", "subHireCostTotal",
  "subtotal", "discountAmount", "taxAmount", "total", "margin",
] as const;

/** Immutable on a general `updateNative` patch: the money anchors + `isTemplate` (a project
 * is never flipped to a template in place — that's a saveAsTemplate copy). `projectNumber`
 * stays editable (a legit code edit). */
const PROJECT_UPDATE_IMMUTABLE = [...PROJECT_MONEY_ANCHORS, "isTemplate"] as const;

const PROJECT_NEVER_CLEAR = new Set<string>([
  "id", "organizationId", "projectNumber", ...PROJECT_UPDATE_IMMUTABLE,
]);

/**
 * updateNative — general project field patch (set/clear) + UPDATE audit, atomic.
 * RBAC(project, update). Option A: the server action keeps Zod validation + the
 * conditional recalc (only when taxRate changes — recalc stays server-side, totals
 * identical); the write + audit move here.
 */
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    set: v.any(),
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // strip organizationId/id (no cross-tenant reassign) + the recalc-owned money anchors
    // and isTemplate (no client-forged totals / in-place template flip).
    const setObj = sanitizeClientSet(set, PROJECT_UPDATE_IMMUTABLE);

    // Bound-check the recalc-INPUT money fields — `set` is v.any() (Convex only
    // enforces "is a number", not range/finiteness), and a browser-direct caller
    // bypasses the client Zod schema entirely. Without this, a forged
    // `taxRate: -1e9` or `discountPercent: NaN` would poison recalcProjectTotals.
    assertProjectMoneyFields({
      taxRate: typeof setObj.taxRate === "number" ? setObj.taxRate : undefined,
      discountPercent: typeof setObj.discountPercent === "number" ? setObj.discountPercent : undefined,
      depositPercent: typeof setObj.depositPercent === "number" ? setObj.depositPercent : undefined,
      depositPaid: typeof setObj.depositPaid === "number" ? setObj.depositPaid : undefined,
      invoicedTotal: typeof setObj.invoicedTotal === "number" ? setObj.invoicedTotal : undefined,
    });

    // A general update that also moves the status FORWARD into PREPPING/CHECKED_OUT/ON_SITE
    // must clear the blocking-comment gate too (parity with the server updateProject path).
    const nextStatus = typeof setObj.status === "string" ? setObj.status : undefined;
    if (nextStatus && nextStatus !== project.status && BLOCKED_FORWARD_STATUSES.has(nextStatus) && !project.isTemplate) {
      await assertNoBlockingCommentsInMutation(ctx, orgId, id, { actionLabel: blockedForwardLabel(nextStatus) });
    }
    if (clear.length === 0) {
      await ctx.db.patch(project._id, setObj);
      await bumpProjectCounters(ctx, orgId, project, { ...project, ...setObj });
    } else {
      const { _id, _creationTime, ...rest } = project;
      const merged: Record<string, unknown> = { ...rest, ...setObj };
      for (const k of clear) {
        if (PROJECT_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(project._id, merged as typeof rest);
      await bumpProjectCounters(ctx, orgId, project, merged);
    }

    const name = (typeof setObj.name === "string" ? setObj.name : undefined) ?? project.name;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated project ${project.projectNumber} - ${name}`,
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * createNative — insert a project with the unique-project-number check + CREATE
 * audit, atomic. RBAC(project, create).
 *
 * Two number paths (mutually exclusive per call):
 *  - MANUAL/TEMPLATE: caller passes `projectNumber` — mirrors createWithUniqueNumber,
 *    returns {created:false} without inserting/auditing when the number clashes
 *    (the caller surfaces DUPLICATE_PROJECT_CODE), {created:true} + audit on success.
 *  - AUTO: caller omits `projectNumber` and passes `autoNumber` config — the number
 *    is allocated IN-mutation (fold of the former server generateProjectNumber loop):
 *    scopeKey → reserveProjectNumberCounter → renderProjectNumber → the org-scoped
 *    clash-guard; on a rendered-code clash the counter advances and we retry
 *    (bounded), so a lagging counter skips past manually-entered codes. Atomic — the
 *    sequence bump and the create commit (or roll back) together.
 */
export const createNative = mutation({
  returns: v.object({ created: v.boolean(), id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.optional(v.string()),
    autoNumber: v.optional(autoNumberValidator),
    name: v.string(),
    ...projectWriteFields,
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, autoNumber, projectNumber: suppliedNumber, ...fields } = args;
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "project", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    // Bound-check the recalc-INPUT money fields — same rationale as updateNative:
    // projectWriteFields only declares `v.number()` (no range/finiteness), and a
    // browser-direct caller bypasses the client Zod schema.
    assertProjectMoneyFields({
      taxRate: fields.taxRate, discountPercent: fields.discountPercent,
      depositPercent: fields.depositPercent, depositPaid: fields.depositPaid,
      invoicedTotal: fields.invoicedTotal,
    });

    // Dup-guard the client-minted cuid first (applies to both number paths). The
    // projectNumber clash-guard below is org-scoped and doesn't catch a cross-org
    // cuid collision. THROW (not the `{created:false}` number-clash signal, which
    // manual callers retry with a NEW number): a cuid collision is a hard error,
    // else another org's by_cuid reads get muddied.
    const dupId = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", fields.id)).first();
    if (dupId) throw new ConvexError("Project already exists");

    // The counter row's updatedAt / render `now` — the server used one `now` for
    // both the create timestamps and the counter (byte-identical here).
    const now = typeof fields.createdAt === "number" ? fields.createdAt : Date.now();

    let projectNumber: string;
    if (suppliedNumber != null) {
      // Manual / template code — single org-scoped clash check; retry is the caller's.
      const clash = await ctx.db
        .query("projects")
        .withIndex("by_organizationId_projectNumber", (q) =>
          q.eq("organizationId", fields.organizationId).eq("projectNumber", suppliedNumber),
        )
        .unique();
      if (clash) return { created: false as const, id: clash.id };
      projectNumber = suppliedNumber;
    } else if (autoNumber) {
      // Auto-number — allocate in-mutation (fold of generateProjectNumber). Reserve a
      // sequence each attempt (matches the server: a rendered-code clash consumes the
      // value and bumps again), render, and re-check the org-scoped clash-guard.
      const scopeKey = scopeKeyFor(autoNumber.reset, autoNumber.parts);
      let resolved: string | null = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        const sequence = await reserveProjectNumberCounter(ctx, fields.organizationId, scopeKey, createId(), now);
        if (!Number.isFinite(sequence)) throw new ConvexError("Invalid project-number sequence");
        const candidate = renderProjectNumber(autoNumber.format, {
          parts: autoNumber.parts,
          sequence,
          padding: autoNumber.padding,
        });
        const clash = await ctx.db
          .query("projects")
          .withIndex("by_organizationId_projectNumber", (q) =>
            q.eq("organizationId", fields.organizationId).eq("projectNumber", candidate),
          )
          .unique();
        if (!clash) {
          resolved = candidate;
          break;
        }
      }
      if (resolved == null) throw new ConvexError("Could not generate a unique project number");
      projectNumber = resolved;
    } else {
      throw new ConvexError("createNative requires either projectNumber or autoNumber config");
    }

    // Strip the recalc-owned money totals: a new project starts with none, and
    // recalcProjectTotals is the only writer. A browser-direct caller could otherwise
    // mint a project with forged financials (projectWriteFields exposes them as args).
    // Non-breaking: createProject never sends these. (bumpProjectCounters keys off
    // status/isTemplate, not money, so it's unaffected by the strip.)
    const insertFields = { ...fields, projectNumber };
    for (const k of PROJECT_MONEY_ANCHORS) delete (insertFields as Record<string, unknown>)[k];

    await ctx.db.insert("projects", insertFields);
    await bumpProjectCounters(ctx, fields.organizationId, null, insertFields);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "project",
      entityId: fields.id,
      entityName: projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created ${fields.isTemplate ? "template" : "project"} ${projectNumber} - ${fields.name}`,
      projectId: fields.id,
      createdAt: typeof fields.createdAt === "number" ? fields.createdAt : 0,
    });

    return { created: true as const, id: fields.id };
  },
});

/**
 * deleteNative — the FULL, atomic project-delete cascade + DELETE audit.
 * RBAC(project, delete). Parity with the (former) server `deleteProject`: only a
 * CANCELLED, non-template project may be deleted; every dependent Convex row is
 * purged in ONE transaction (no more N server→Convex round-trips, no orphan window):
 *
 *   1. Free loose checked-out/confirmed assets → setAssetsStatus (dashboard counters!)
 *   2. Free checked-out/confirmed kits inline (kits carry no counter)
 *   3. Free those kits' serialized member assets → setAssetsStatus
 *   4. Cascade every top-level line item (children + units) → removeLineItemCascadeCore
 *   5. Crew assignments (→ shifts + linked time entries) → deleteCrewAssignmentCascadeCore
 *   6. Project managers / tasks / services (inline)
 *   7. Grouping (categories / groups / slots) → deleteAllForProjectCore
 *   8. projectModelRevenues rollup (Convex-only cache — MUST purge or it orphans)
 *   then bumpProjectCounters + delete the project row + DELETE audit.
 *
 * `freedAssets`/`freedKits` are computed IN-mutation (never trusted from the client)
 * and returned + audited. `defaultLocationId` is the org's default location (resolved
 * by the caller, mirrors getDefaultLocation) applied to every freed asset/kit.
 * Convex forbids mutation→mutation, so the cascade reuses extracted `*Core` fns.
 */
/** Free a set of assets to AVAILABLE, but ONLY the ones that belong to `orgId` — a
 *  forged line/kit-member could otherwise point at a foreign asset, and setAssetsStatus
 *  resolves by the GLOBAL by_cuid index. Routes through setAssetsStatus so the sharded
 *  asset counters stay in sync. Returns the count actually freed. */
async function freeOrgAssets(
  ctx: Parameters<typeof setAssetsStatus>[0],
  assetIds: string[],
  orgId: string,
  locationId: string | null,
  now: number,
): Promise<number> {
  const owned: string[] = [];
  for (const aid of [...new Set(assetIds)]) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", aid)).first();
    if (asset && asset.organizationId === orgId) owned.push(aid);
  }
  if (owned.length > 0) await setAssetsStatus(ctx, owned, "AVAILABLE", locationId, true, now);
  return owned.length;
}

export const deleteNative = mutation({
  returns: v.object({ id: v.string(), freedAssets: v.number(), freedKits: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    defaultLocationId: v.union(v.string(), v.null()),
    // Legacy args — retained for wire-compat but IGNORED: the freed counts are now
    // computed in-mutation (a client must not be able to forge the audit detail).
    freedAssets: v.optional(v.number()),
    freedKits: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, defaultLocationId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "delete");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.status !== "CANCELLED") {
      throw new ConvexError({ code: "DELETE_GUARD", message: "Only cancelled projects can be deleted." });
    }
    if (project.isTemplate) {
      throw new ConvexError({ code: "DELETE_GUARD", message: "Templates must be deleted via deleteTemplateNative." });
    }

    // Validate the client-supplied default location belongs to this org (by_cuid is global)
    // before it's written onto freed assets/kits — else use null (clear the location).
    let safeLocationId: string | null = null;
    if (defaultLocationId != null) {
      const loc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", defaultLocationId)).first();
      if (loc && loc.organizationId === orgId) safeLocationId = defaultLocationId;
    }

    // ── Step 0: scan the project's line items (org-filtered) → collect the assets
    // and kits to free. by_projectId is a project-scoped index; the org re-check is
    // defensive (a project's lines always share its org).
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((li) => li.organizationId === orgId);

    const checkedOutAssetIds: string[] = [];
    const checkedOutKitIds: string[] = [];
    for (const li of lineItems) {
      if (li.assetId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) checkedOutAssetIds.push(li.assetId);
      if (li.kitId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) checkedOutKitIds.push(li.kitId);
    }

    // Step 1 — free loose checked-out assets (org-scoped; routes through setAssetsStatus so
    // the sharded dashboard counters stay in sync; clear location when there's no default).
    await freeOrgAssets(ctx, checkedOutAssetIds, orgId, safeLocationId, now);

    // Step 2 — free checked-out kits inline (status AVAILABLE + location; kits have
    // no counter). Leave the kit's location untouched when there's no default.
    for (const kitId of checkedOutKitIds) {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
      if (!kit || kit.organizationId !== orgId) continue;
      await ctx.db.patch(kit._id, {
        status: "AVAILABLE",
        ...(safeLocationId != null ? { locationId: safeLocationId } : {}),
        updatedAt: now,
      });
    }

    // Step 3 — free those kits' serialized member assets (org-scoped, counter-safe path).
    const kitAssetIds: string[] = [];
    for (const kitId of checkedOutKitIds) {
      const members = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
      for (const m of members) if (m.organizationId === orgId) kitAssetIds.push(m.assetId);
    }
    await freeOrgAssets(ctx, kitAssetIds, orgId, safeLocationId, now);

    // Step 4 — cascade every top-level line (its children + all units go with it).
    for (const li of lineItems) {
      if (li.parentLineItemId == null) await removeLineItemCascadeCore(ctx, li.id);
    }

    // Step 5 — crew assignments (→ shifts + linked time entries + offer counter).
    const assignments = (
      await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((a) => a.organizationId === orgId);
    for (const a of assignments) await deleteCrewAssignmentCascadeCore(ctx, a);

    // Step 6 — project managers / tasks / services (org-filtered inline deletes).
    // NOT projectServices.removeManyCascade — that would re-cascade lines/crew we
    // already handled above.
    const pms = (
      await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of pms) await ctx.db.delete(r._id);
    const tasks = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of tasks) await ctx.db.delete(r._id);
    const services = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of services) await ctx.db.delete(r._id);

    // Step 7 — grouping (categories / groups / slots).
    await deleteAllForProjectCore(ctx, id);

    // Step 8 — projectModelRevenues rollup (Convex-only cache; no FK to cascade —
    // the (former) native stub missed this, orphaning one row per model per delete).
    const rollups = (
      await ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of rollups) await ctx.db.delete(r._id);

    // Finally — project row + active-project counter + DELETE audit.
    await bumpProjectCounters(ctx, orgId, project, null);
    await ctx.db.delete(project._id);

    const freedAssets = checkedOutAssetIds.length;
    const freedKits = checkedOutKitIds.length;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted project ${project.projectNumber} - ${project.name}`,
      details: { deleted: { projectNumber: project.projectNumber, name: project.name }, freedAssets, freedKits },
      projectId: id,
      createdAt: now,
    });

    return { id, freedAssets, freedKits };
  },
});

/**
 * deleteTemplateNative — the atomic template-delete cascade. RBAC(project, delete).
 * Parity with the (former) server `deleteTemplate`: a template has NO CANCELLED
 * precondition, frees NO assets/kits (a template holds none checked out), has NO
 * crew cascade and writes NO audit. Cascade: PM/tasks/services → grouping → line
 * items → projectModelRevenues → the project row (+ counter).
 */
export const deleteTemplateNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "delete");
    await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (!project.isTemplate) {
      throw new ConvexError({ code: "NOT_A_TEMPLATE", message: "That ID points at a project, not a template." });
    }

    // Project managers / tasks / services (org-filtered inline deletes).
    const pms = (
      await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of pms) await ctx.db.delete(r._id);
    const tasks = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of tasks) await ctx.db.delete(r._id);
    const services = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of services) await ctx.db.delete(r._id);

    // Grouping (categories / groups / slots).
    await deleteAllForProjectCore(ctx, id);

    // Template line items (top-level cascade → children + units).
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((li) => li.organizationId === orgId);
    for (const li of lineItems) {
      if (li.parentLineItemId == null) await removeLineItemCascadeCore(ctx, li.id);
    }

    // projectModelRevenues rollup (Convex-only cache).
    const rollups = (
      await ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of rollups) await ctx.db.delete(r._id);

    // Delete the template row (+ active-project counter — templates never count as
    // active, so the delta is 0, but keep the call uniform with deleteNative).
    await bumpProjectCounters(ctx, orgId, project, null);
    await ctx.db.delete(project._id);

    return { success: true };
  },
});

/** Sanitize a numeric that will feed recalc — a non-finite client value falls
 *  back to null (the org-default path). */
const finiteOrNull = (n: number | null): number | null => (n != null && Number.isFinite(n) ? n : null);

/** Copy the project SCALARS a duplicate carries forward (parity with the server
 *  createWithUniqueNumber call in duplicateProject). Dates / depositPaid /
 *  invoicedTotal / notes-money are deliberately NOT copied. */
function duplicateProjectScalars(source: {
  type?: string; clientId?: string; description?: string; locationId?: string;
  siteContactName?: string; siteContactPhone?: string; siteContactEmail?: string;
  crewNotes?: string; internalNotes?: string; clientNotes?: string;
  discountPercent?: number; depositPercent?: number;
  defaultRentalPeriod?: string; defaultRentalQuantity?: number; taxRate?: number;
  tags?: string[];
}): Record<string, unknown> {
  return {
    ...(source.type ? { type: source.type } : {}),
    ...(source.clientId ? { clientId: source.clientId } : {}),
    ...(source.description ? { description: source.description } : {}),
    ...(source.locationId ? { locationId: source.locationId } : {}),
    ...(source.siteContactName ? { siteContactName: source.siteContactName } : {}),
    ...(source.siteContactPhone ? { siteContactPhone: source.siteContactPhone } : {}),
    ...(source.siteContactEmail ? { siteContactEmail: source.siteContactEmail } : {}),
    ...(source.crewNotes ? { crewNotes: source.crewNotes } : {}),
    ...(source.internalNotes ? { internalNotes: source.internalNotes } : {}),
    ...(source.clientNotes ? { clientNotes: source.clientNotes } : {}),
    ...(source.discountPercent != null ? { discountPercent: source.discountPercent } : {}),
    ...(source.depositPercent != null ? { depositPercent: source.depositPercent } : {}),
    ...(source.defaultRentalPeriod ? { defaultRentalPeriod: source.defaultRentalPeriod } : {}),
    ...(source.defaultRentalQuantity != null ? { defaultRentalQuantity: source.defaultRentalQuantity } : {}),
    ...(source.taxRate != null ? { taxRate: source.taxRate } : {}),
    tags: source.tags ?? [],
  };
}

type SrcLine = {
  id: string; organizationId: string; type?: string; modelId?: string; bulkAssetId?: string;
  kitId?: string; supplierId?: string; description?: string; quantity?: number; unitPrice?: number;
  pricingType?: string; duration?: number; discount?: number; lineTotal?: number; sortOrder?: number;
  groupName?: string; notes?: string; isOptional?: boolean; showSubhireOnDocs?: boolean;
  pricingMode?: string; childKind?: string; isKitChild?: boolean; parentLineItemId?: string;
  categoryId?: string; groupId?: string;
};

/**
 * duplicateNative — deep-copy a source project into a fresh project (status
 * ENQUIRY, isTemplate false), atomic. RBAC(project, create). Parity with the
 * (former) server duplicateProject: copies categories → groups (remapped
 * categoryId) → line items parent-then-children (remapped categoryId/groupId,
 * status QUOTED) → project managers, then recalcProjectTotals. Deliberately does
 * NOT copy categorySlots / services / tasks / crew. Secondary-row cuids are minted
 * inline (Convex tolerates createId()); the project's `newId` is client-passed +
 * dup-guarded. A number clash on `newProjectNumber` throws (the caller supplies a
 * user-chosen code, not a retry loop).
 */
export const duplicateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    sourceId: v.string(),
    newId: v.string(),
    newProjectNumber: v.string(),
    newName: v.string(),
    orgId: v.string(),
    // Accepted-but-IGNORED for backward-compat with the pre-internalization app image.
    // The rate is ALWAYS resolved in-mutation from orgSettings — a client value is
    // never trusted (a browser caller could otherwise spoof a money-affecting tax
    // rate on the duplicated project's recalculated totals).
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { sourceId, newId, newProjectNumber, newName, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    // Source project — org-checked (by_cuid is global).
    const source = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", sourceId)).first();
    if (!source || source.organizationId !== orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    // Dup-guard the client-minted project cuid (COLLECT all — a foreign-org
    // collision must throw, not silently reuse another org's row).
    const cuidMatches = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", newId)).collect();
    if (cuidMatches.length > 0) throw new ConvexError("Project already exists");

    // Number clash (org-scoped @@unique guard) — a user-chosen code, so a hard error.
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) => q.eq("organizationId", orgId).eq("projectNumber", newProjectNumber))
      .unique();
    if (clash) throw new ConvexError({ code: "DUPLICATE_PROJECT_CODE", message: `A project with code "${newProjectNumber}" already exists.` });

    // 1. New project row (children below reference its id).
    await ctx.db.insert("projects", {
      id: newId,
      organizationId: orgId,
      projectNumber: newProjectNumber,
      name: newName,
      status: "ENQUIRY",
      isTemplate: false,
      ...duplicateProjectScalars(source),
      createdAt: now,
      updatedAt: now,
    });

    // 2. Categories (sorted) → catIdMap.
    const sourceCategories = (
      await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", sourceId)).collect()
    )
      .filter((c) => c.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const catIdMap = new Map<string, string>();
    for (const cat of sourceCategories) {
      const nid = createId();
      catIdMap.set(cat.id, nid);
      await ctx.db.insert("projectCategories", {
        id: nid,
        organizationId: orgId,
        projectId: newId,
        name: cat.name,
        sortOrder: cat.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 3. Groups → groupIdMap (categoryId remapped).
    const sourceGroups = (
      await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", sourceId)).collect()
    ).filter((g) => g.organizationId === orgId);
    const groupIdMap = new Map<string, string>();
    const groupById = new Map<string, (typeof sourceGroups)[number]>();
    for (const g of sourceGroups) groupById.set(g.id, g);
    for (const group of sourceGroups) {
      const nid = createId();
      groupIdMap.set(group.id, nid);
      await ctx.db.insert("projectGroups", {
        id: nid,
        organizationId: orgId,
        projectId: newId,
        ...(group.categoryId ? { categoryId: catIdMap.get(group.categoryId) } : {}),
        title: group.title,
        ...(group.description != null ? { description: group.description } : {}),
        ...(group.quantity != null ? { quantity: group.quantity } : {}),
        ...(group.price != null ? { price: group.price } : {}),
        ...(group.suggestedPrice != null ? { suggestedPrice: group.suggestedPrice } : {}),
        ...(group.rentalPeriod != null ? { rentalPeriod: group.rentalPeriod } : {}),
        ...(group.rentalQuantity != null ? { rentalQuantity: group.rentalQuantity } : {}),
        sortOrder: group.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 4. Line items — parents then their children. A parent's remapped
    //    category/group is inherited by its children (parity with the server's
    //    copyLineItem, which passes newCategoryId/newGroupId down to children).
    const allLines = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", sourceId)).collect()
    ).filter((li) => li.organizationId === orgId) as unknown as SrcLine[];
    const childrenByParent = new Map<string, SrcLine[]>();
    for (const li of allLines) {
      if (li.isKitChild && li.parentLineItemId) {
        const arr = childrenByParent.get(li.parentLineItemId) ?? [];
        arr.push(li);
        childrenByParent.set(li.parentLineItemId, arr);
      }
    }
    const parents = allLines
      .filter((li) => !li.isKitChild)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    for (const li of parents) {
      // Resolve the new category/group this parent (and its children) land under.
      let newGroupId: string | null = null;
      let newCatId: string | null = null;
      if (li.groupId) {
        newGroupId = groupIdMap.get(li.groupId) ?? null;
        const srcGroup = groupById.get(li.groupId);
        newCatId = srcGroup?.categoryId ? catIdMap.get(srcGroup.categoryId) ?? null : null;
      } else if (li.categoryId) {
        newCatId = catIdMap.get(li.categoryId) ?? null;
      }

      const newParentId = createId();
      await ctx.db.insert("projectLineItems", {
        id: newParentId,
        organizationId: orgId,
        projectId: newId,
        ...(newCatId ? { categoryId: newCatId } : {}),
        ...(newGroupId ? { groupId: newGroupId } : {}),
        ...(li.type ? { type: li.type } : {}),
        ...(li.modelId ? { modelId: li.modelId } : {}),
        ...(li.bulkAssetId ? { bulkAssetId: li.bulkAssetId } : {}),
        ...(li.kitId ? { kitId: li.kitId } : {}),
        ...(li.supplierId ? { supplierId: li.supplierId } : {}),
        ...(li.description != null ? { description: li.description } : {}),
        ...(li.quantity != null ? { quantity: li.quantity } : {}),
        ...(li.unitPrice != null ? { unitPrice: Number(li.unitPrice) } : {}),
        ...(li.pricingType ? { pricingType: li.pricingType } : {}),
        ...(li.duration != null ? { duration: Number(li.duration) } : {}),
        ...(li.discount != null ? { discount: Number(li.discount) } : {}),
        ...(li.lineTotal != null ? { lineTotal: Number(li.lineTotal) } : {}),
        ...(li.sortOrder != null ? { sortOrder: li.sortOrder } : {}),
        ...(li.groupName != null ? { groupName: li.groupName } : {}),
        ...(li.notes != null ? { notes: li.notes } : {}),
        ...(li.isOptional != null ? { isOptional: li.isOptional } : {}),
        ...(li.showSubhireOnDocs != null ? { showSubhireOnDocs: li.showSubhireOnDocs } : {}),
        ...(li.pricingMode ? { pricingMode: li.pricingMode } : {}),
        isKitChild: false,
        status: "QUOTED",
        createdAt: now,
        updatedAt: now,
      } as Record<string, unknown> as never);

      for (const child of childrenByParent.get(li.id) ?? []) {
        await ctx.db.insert("projectLineItems", {
          id: createId(),
          organizationId: orgId,
          projectId: newId,
          ...(newCatId ? { categoryId: newCatId } : {}),
          ...(newGroupId ? { groupId: newGroupId } : {}),
          ...(child.type ? { type: child.type } : {}),
          ...(child.modelId ? { modelId: child.modelId } : {}),
          ...(child.bulkAssetId ? { bulkAssetId: child.bulkAssetId } : {}),
          ...(child.description != null ? { description: child.description } : {}),
          ...(child.quantity != null ? { quantity: child.quantity } : {}),
          ...(child.unitPrice != null ? { unitPrice: Number(child.unitPrice) } : {}),
          ...(child.pricingType ? { pricingType: child.pricingType } : {}),
          ...(child.duration != null ? { duration: Number(child.duration) } : {}),
          ...(child.discount != null ? { discount: Number(child.discount) } : {}),
          ...(child.lineTotal != null ? { lineTotal: Number(child.lineTotal) } : {}),
          ...(child.sortOrder != null ? { sortOrder: child.sortOrder } : {}),
          ...(child.groupName != null ? { groupName: child.groupName } : {}),
          ...(child.notes != null ? { notes: child.notes } : {}),
          ...(child.childKind ? { childKind: child.childKind } : {}),
          isKitChild: true,
          parentLineItemId: newParentId,
          status: "QUOTED",
          createdAt: now,
          updatedAt: now,
        } as Record<string, unknown> as never);
      }
    }

    // 5. Project managers.
    const sourcePMs = (
      await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", sourceId)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const pm of sourcePMs) {
      await ctx.db.insert("projectManagers", {
        id: createId(),
        organizationId: orgId,
        projectId: newId,
        userId: pm.userId,
        addedAt: now,
      });
    }

    // 6. Recalc totals from the copied lines (never trust client money — org default
    // tax rate resolved in-mutation from orgSettings, not the client arg above).
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, newId, orgId, orgDefaultTaxRate, now);

    // CREATE audit for the new project (native path logs it atomically).
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "CREATE",
      entityType: "project",
      entityId: newId,
      entityName: newProjectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Duplicated project ${source.projectNumber} to ${newProjectNumber} - ${newName}`,
      projectId: newId,
      createdAt: now,
    });

    return { id: newId };
  },
});

/**
 * saveAsTemplateNative — snapshot a source project as a TEMPLATE (isTemplate true,
 * status ENQUIRY), atomic. RBAC(project, create). Parity with the (former) server
 * saveAsTemplate: copies ONLY the line items (parents + children, status QUOTED)
 * and — critically — OMITS categoryId/groupId on every copied line (a template
 * carries no grouping structure). Copies NO categories / groups / project managers,
 * writes NO audit. `templateNumber` is resolved by the caller (generateTemplateCode,
 * a Convex-mirror template count). recalcProjectTotals recomputes totals.
 */
export const saveAsTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    sourceId: v.string(),
    newId: v.string(),
    templateNumber: v.string(),
    templateName: v.string(),
    orgId: v.string(),
    // Accepted-but-IGNORED for backward-compat — see duplicateNative's comment.
    // Always resolved in-mutation from orgSettings, never trusted from the client.
    orgDefaultTaxRate: v.optional(v.union(v.number(), v.null())),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, { sourceId, newId, templateNumber, templateName, orgId, now, actor: suppliedActor }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "create");
    await resolveActor(ctx, suppliedActor);

    const source = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", sourceId)).first();
    if (!source || source.organizationId !== orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    // Dup-guard the client-minted template cuid (COLLECT all).
    const cuidMatches = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", newId)).collect();
    if (cuidMatches.length > 0) throw new ConvexError("Template already exists");

    // Number clash (org-scoped @@unique guard).
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) => q.eq("organizationId", orgId).eq("projectNumber", templateNumber))
      .unique();
    if (clash) throw new ConvexError({ code: "DUPLICATE_PROJECT_CODE", message: `A template with code "${templateNumber}" already exists.` });

    // 1. Template project row. Parity: saveAsTemplate copies FEWER scalars than
    //    duplicate — no taxRate, no defaultRentalPeriod/Quantity.
    await ctx.db.insert("projects", {
      id: newId,
      organizationId: orgId,
      projectNumber: templateNumber,
      name: templateName,
      status: "ENQUIRY",
      isTemplate: true,
      ...(source.type ? { type: source.type } : {}),
      ...(source.clientId ? { clientId: source.clientId } : {}),
      ...(source.description ? { description: source.description } : {}),
      ...(source.locationId ? { locationId: source.locationId } : {}),
      ...(source.siteContactName ? { siteContactName: source.siteContactName } : {}),
      ...(source.siteContactPhone ? { siteContactPhone: source.siteContactPhone } : {}),
      ...(source.siteContactEmail ? { siteContactEmail: source.siteContactEmail } : {}),
      ...(source.crewNotes ? { crewNotes: source.crewNotes } : {}),
      ...(source.internalNotes ? { internalNotes: source.internalNotes } : {}),
      ...(source.clientNotes ? { clientNotes: source.clientNotes } : {}),
      ...(source.discountPercent != null ? { discountPercent: source.discountPercent } : {}),
      ...(source.depositPercent != null ? { depositPercent: source.depositPercent } : {}),
      tags: source.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });

    // 2. Line items — parents then children. ★ categoryId/groupId OMITTED (parity).
    const allLines = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", sourceId)).collect()
    ).filter((li) => li.organizationId === orgId) as unknown as SrcLine[];
    const childrenByParent = new Map<string, SrcLine[]>();
    for (const li of allLines) {
      if (li.isKitChild && li.parentLineItemId) {
        const arr = childrenByParent.get(li.parentLineItemId) ?? [];
        arr.push(li);
        childrenByParent.set(li.parentLineItemId, arr);
      }
    }
    const parents = allLines
      .filter((li) => !li.isKitChild)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    for (const li of parents) {
      const newParentId = createId();
      await ctx.db.insert("projectLineItems", {
        id: newParentId,
        organizationId: orgId,
        projectId: newId,
        ...(li.type ? { type: li.type } : {}),
        ...(li.modelId ? { modelId: li.modelId } : {}),
        ...(li.bulkAssetId ? { bulkAssetId: li.bulkAssetId } : {}),
        ...(li.kitId ? { kitId: li.kitId } : {}),
        ...(li.supplierId ? { supplierId: li.supplierId } : {}),
        ...(li.description != null ? { description: li.description } : {}),
        ...(li.quantity != null ? { quantity: li.quantity } : {}),
        ...(li.unitPrice != null ? { unitPrice: Number(li.unitPrice) } : {}),
        ...(li.pricingType ? { pricingType: li.pricingType } : {}),
        ...(li.duration != null ? { duration: Number(li.duration) } : {}),
        ...(li.discount != null ? { discount: Number(li.discount) } : {}),
        ...(li.lineTotal != null ? { lineTotal: Number(li.lineTotal) } : {}),
        ...(li.sortOrder != null ? { sortOrder: li.sortOrder } : {}),
        ...(li.groupName != null ? { groupName: li.groupName } : {}),
        ...(li.notes != null ? { notes: li.notes } : {}),
        ...(li.isOptional != null ? { isOptional: li.isOptional } : {}),
        ...(li.showSubhireOnDocs != null ? { showSubhireOnDocs: li.showSubhireOnDocs } : {}),
        ...(li.pricingMode ? { pricingMode: li.pricingMode } : {}),
        isKitChild: false,
        status: "QUOTED",
        createdAt: now,
        updatedAt: now,
      } as Record<string, unknown> as never);

      for (const child of childrenByParent.get(li.id) ?? []) {
        await ctx.db.insert("projectLineItems", {
          id: createId(),
          organizationId: orgId,
          projectId: newId,
          ...(child.type ? { type: child.type } : {}),
          ...(child.modelId ? { modelId: child.modelId } : {}),
          ...(child.bulkAssetId ? { bulkAssetId: child.bulkAssetId } : {}),
          ...(child.description != null ? { description: child.description } : {}),
          ...(child.quantity != null ? { quantity: child.quantity } : {}),
          ...(child.unitPrice != null ? { unitPrice: Number(child.unitPrice) } : {}),
          ...(child.pricingType ? { pricingType: child.pricingType } : {}),
          ...(child.duration != null ? { duration: Number(child.duration) } : {}),
          ...(child.discount != null ? { discount: Number(child.discount) } : {}),
          ...(child.lineTotal != null ? { lineTotal: Number(child.lineTotal) } : {}),
          ...(child.sortOrder != null ? { sortOrder: child.sortOrder } : {}),
          ...(child.groupName != null ? { groupName: child.groupName } : {}),
          ...(child.notes != null ? { notes: child.notes } : {}),
          isKitChild: true,
          parentLineItemId: newParentId,
          status: "QUOTED",
          createdAt: now,
          updatedAt: now,
        } as Record<string, unknown> as never);
      }
    }

    // 3. Recalc totals from the copied lines (org default tax rate resolved
    // in-mutation from orgSettings, never trusted from the client).
    const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, newId, orgId, finiteOrNull(orgDefaultTaxRate), now);

    return { id: newId };
  },
});
