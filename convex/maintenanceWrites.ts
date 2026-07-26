import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertMemberInOrg } from "./lib/orgRef";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { enqueueWebhookEvent } from "./lib/webhookEnqueue";
import { assertStrLen, assertNumRange, assertArrayMax } from "./lib/fieldGuards";
import { isLinkRow } from "./lib/maintenanceRecordAssetKind";
import * as enums from "./lib/validators";

/**
 * Native MAINTENANCE write state machine (Phase 3 browser-direct — replaces
 * createMaintenanceRecord / updateMaintenanceRecord / deleteMaintenanceRecord in
 * src/server/maintenance.ts). Folds the record write + the maintenanceRecordAssets
 * link diff + the MaintenanceRecord→Asset.status state machine + the audit (+ the
 * gated create webhook) into ONE atomic Convex mutation.
 *
 * The fold's win: the hold/release helpers run against `ctx.db`, which SEES the
 * mutation's own writes — so the old "compute the still-held set OUTSIDE the tx
 * because Convex calls can't run inside a Prisma tx" dance is gone. The
 * cross-record "is this asset still held by ANOTHER active record?" check reads the
 * fresh link + record state directly.
 *
 * Security bar (exact order): assertWritesEnabled → enforceBrowserWriteLimit →
 * requireOrgPermission(maintenance, <action>) → resolveActor. Then a per-row org
 * re-check on EVERY doc fetched by the GLOBAL by_cuid index (record, links' parent,
 * assets). ConvexError only. writeActivityLog is in-transaction.
 *
 * ── State machine (parity with src/server/maintenance.ts) ──
 *   SCHEDULED        does NOT hold the assets
 *   AWAITING_PARTS / IN_PROGRESS / QA   HOLD (AVAILABLE → IN_MAINTENANCE, guarded)
 *   COMPLETED PASS   RELEASE (IN_MAINTENANCE → AVAILABLE, guarded)
 *   COMPLETED FAIL   HOLD (leaves IN_MAINTENANCE — deliberately does NOT release)
 *   CANCELLED        RELEASE (same guards as COMPLETED PASS)
 * Both guards are load-bearing: HOLD only touches AVAILABLE assets, RELEASE only
 * touches IN_MAINTENANCE assets — so a status set by warehouse checkout / T&T /
 * lost-retired is never clobbered.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Mirrors `maintenanceSchema` (src/lib/validations/maintenance.ts) string-length/
 * numeric/array bounds — `v.string()`/`v.number()`/`v.array()` only enforce type,
 * not these business constraints, so a browser-direct caller bypassing the client
 * Zod parse would otherwise skip them entirely (R-8.6.2).
 */
function assertMaintenanceFields(f: {
  title?: string;
  description?: string;
  cost?: number;
  partsUsed?: string;
  photos?: string[];
}): void {
  assertStrLen(f.title, "title", { min: 1, max: 200 });
  assertStrLen(f.description, "description", { max: 5000 });
  assertNumRange(f.cost, "cost", { min: 0 });
  assertStrLen(f.partsUsed, "partsUsed", { max: 2000 });
  assertArrayMax(f.photos, "photos", 20);
}

/** Statuses where the asset is physically in the workshop's hands. */
const HOLDING_STATUSES = ["AWAITING_PARTS", "IN_PROGRESS", "QA"];

/** Prisma default is SCHEDULED — an absent Convex `status` reads as SCHEDULED. */
function statusOf(rec: { status?: string | null }): string {
  return rec.status ?? "SCHEDULED";
}

function isHoldingStatus(status: string): boolean {
  return HOLDING_STATUSES.includes(status);
}

/** Fetch an asset by cuid + org re-check (by_cuid is a GLOBAL index). */
async function fetchOrgAsset(
  ctx: MutationCtx,
  orgId: string,
  assetId: string,
): Promise<Doc<"assets"> | null> {
  const a = await ctx.db
    .query("assets")
    .withIndex("by_cuid", (q) => q.eq("id", assetId))
    .unique();
  if (!a || a.organizationId !== orgId) return null;
  return a;
}

/**
 * Mark assets IN_MAINTENANCE, but ONLY if currently AVAILABLE (the load-bearing
 * guard — mirrors the Prisma `where: { status: AVAILABLE }`). Per-row org re-check.
 */
async function holdAssets(
  ctx: MutationCtx,
  orgId: string,
  assetIds: string[],
  now: number,
): Promise<void> {
  for (const id of assetIds) {
    const a = await fetchOrgAsset(ctx, orgId, id);
    if (!a) continue;
    if ((a.status ?? "AVAILABLE") === "AVAILABLE") {
      await ctx.db.patch(a._id, { status: "IN_MAINTENANCE", updatedAt: now });
    }
  }
}

/**
 * Which of `assetIds` are STILL held by ANOTHER active holding record (id !==
 * excludeRecordId, status isHolding, same org). Reads the fresh link + record state
 * from ctx.db (the fold's win). Org re-check on every parent record.
 */
async function computeStillHeldIds(
  ctx: MutationCtx,
  orgId: string,
  assetIds: string[],
  excludeRecordId: string,
): Promise<Set<string>> {
  const stillHeld = new Set<string>();
  for (const assetId of assetIds) {
    const links = (
      await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
        .collect()
    ).filter(isLinkRow); // WS6: a CHECKOFF row sharing this assetId never holds anything
    for (const l of links) {
      if (l.maintenanceRecordId === excludeRecordId) continue;
      const rec = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_cuid", (q) => q.eq("id", l.maintenanceRecordId))
        .unique();
      if (!rec || rec.organizationId !== orgId) continue; // org re-check
      if (isHoldingStatus(statusOf(rec))) {
        stillHeld.add(assetId);
        break;
      }
    }
  }
  return stillHeld;
}

/**
 * Release assets to AVAILABLE, but ONLY if currently IN_MAINTENANCE AND not in the
 * still-held set (both load-bearing). Per-row org re-check.
 */
async function releaseAssets(
  ctx: MutationCtx,
  orgId: string,
  assetIds: string[],
  stillHeldIds: Set<string>,
  now: number,
): Promise<void> {
  for (const id of assetIds) {
    if (stillHeldIds.has(id)) continue;
    const a = await fetchOrgAsset(ctx, orgId, id);
    if (!a) continue;
    if ((a.status ?? "AVAILABLE") === "IN_MAINTENANCE") {
      await ctx.db.patch(a._id, { status: "AVAILABLE", updatedAt: now });
    }
  }
}

/**
 * Existing asset LINKS for a record (parent-scoped; the parent org is checked).
 * Filters out WS6 CHECKOFF rows — a recurring-PM progress row sharing this
 * record's id is never a hold/release link (see maintenanceRecordAssetKind.ts).
 */
async function existingLinks(ctx: MutationCtx, recordId: string) {
  return (
    await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId))
      .collect()
  ).filter(isLinkRow);
}

/**
 * ALL `maintenanceRecordAssets` rows for a record, BOTH kinds — used only by the
 * cascade delete (deleteNative below). Deleting a record must remove its WS6
 * CHECKOFF progress history too, not just its hold/release LINK rows, or a
 * deleted record would leave orphaned rows pointing at a nonexistent parent.
 */
async function allRecordAssetRows(ctx: MutationCtx, recordId: string) {
  return await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId))
    .collect();
}

/**
 * Insert one maintenance→asset link at a client-minted id. Idempotent on
 * (recordId, assetId); rejects a link-id that collides with a DIFFERENT parent
 * (foreign id → cross-tenant injection). Org-checks the asset first.
 */
async function insertLink(
  ctx: MutationCtx,
  orgId: string,
  recordId: string,
  linkId: string,
  assetId: string,
): Promise<void> {
  const asset = await fetchOrgAsset(ctx, orgId, assetId);
  if (!asset) throw new ConvexError("Asset not found in organization: " + assetId);

  // WS6: the composite index can also return a CHECKOFF row sharing this
  // (record, asset) pair (a serialised unit already checked off on this cycle) —
  // that is NOT a hold/release link, so only a LINK row satisfies idempotency.
  const pair = (
    await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId_assetId", (q) =>
        q.eq("maintenanceRecordId", recordId).eq("assetId", assetId),
      )
      .collect()
  ).find(isLinkRow);
  if (pair) return; // idempotent on the unique (recordId, assetId) LINK pair

  // The (recordId, assetId) LINK pair does NOT exist (checked above), so any row
  // already holding this linkId is a genuine collision — reusing it for a
  // DIFFERENT (record, asset) would either corrupt by_cuid or silently drop the
  // requested link (leaving the asset held IN_MAINTENANCE with no link to
  // release it). Reject unconditionally.
  const idDup = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_cuid", (q) => q.eq("id", linkId))
    .unique();
  if (idDup) throw new ConvexError("Maintenance link id collision");
  await ctx.db.insert("maintenanceRecordAssets", {
    id: linkId,
    maintenanceRecordId: recordId,
    assetId,
    kind: "LINK",
  });
}

const assetLinkArg = v.object({ id: v.string(), assetId: v.string() });

// ─── createNative (parity with createMaintenanceRecord) ─────────────────────
export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()), // epoch ms
    completedDate: v.optional(v.number()), // epoch ms
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()), // epoch ms
    tags: v.optional(v.array(v.string())),
    assetLinks: v.array(assetLinkArg), // client mints one id per link
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    emitSideEffects: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "create");
    const actor = await resolveActor(ctx, a.actor);
    assertMaintenanceFields(a);

    // Client-supplied reporter/assignee user FKs — validate org membership (the Better-Auth
    // user table has no org column; a foreign user id would leak that user's name on reads).
    if (a.reportedById) await assertMemberInOrg(ctx, a.orgId, a.reportedById);
    if (a.assignedToId) await assertMemberInOrg(ctx, a.orgId, a.assignedToId);

    const assetIds = Array.from(new Set(a.assetLinks.map((l) => l.assetId)));
    if (assetIds.length === 0) throw new ConvexError("At least one asset is required");

    // Dup-guard by_cuid (GLOBAL): reject a cross-org collision, treat a same-org
    // collision as an idempotent retry (the prior call already finished).
    const dup = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_cuid", (q) => q.eq("id", a.recordId))
      .unique();
    if (dup) {
      if (dup.organizationId !== a.orgId) {
        throw new ConvexError("Maintenance record id already exists");
      }
      return { id: a.recordId };
    }

    const status = a.status ?? "SCHEDULED";

    await ctx.db.insert("maintenanceRecords", {
      id: a.recordId,
      organizationId: a.orgId,
      type: a.type,
      status,
      title: a.title,
      ...(a.description ? { description: a.description } : {}),
      reportedById: a.reportedById || actor.userId,
      ...(a.assignedToId ? { assignedToId: a.assignedToId } : {}),
      ...(a.scheduledDate != null ? { scheduledDate: a.scheduledDate } : {}),
      ...(a.completedDate != null ? { completedDate: a.completedDate } : {}),
      ...(a.cost != null ? { cost: a.cost } : {}),
      ...(a.partsUsed ? { partsUsed: a.partsUsed } : {}),
      photos: a.photos ?? [],
      ...(a.result ? { result: a.result } : {}),
      ...(a.nextDueDate != null ? { nextDueDate: a.nextDueDate } : {}),
      tags: a.tags ?? [],
      createdAt: a.now,
      updatedAt: a.now,
    });

    // Link the assets (idempotent per pair; org-checked; foreign link-id rejected).
    for (const link of a.assetLinks) {
      await insertLink(ctx, a.orgId, a.recordId, link.id, link.assetId);
    }

    // Asset state-machine transitions. On COMPLETED-PASS the still-held check
    // excludes THIS record (its own fresh links must not self-hold).
    if (isHoldingStatus(status)) {
      await holdAssets(ctx, a.orgId, assetIds, a.now);
    } else if (status === "COMPLETED" && a.result !== "FAIL") {
      const stillHeld = await computeStillHeldIds(ctx, a.orgId, assetIds, a.recordId);
      await releaseAssets(ctx, a.orgId, assetIds, stillHeld, a.now);
    }

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CREATE",
      entityType: "maintenance",
      entityId: a.recordId,
      entityName: a.title,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created maintenance record: ${a.title}`,
      details: { assetCount: assetIds.length },
      createdAt: a.now,
    });

    // Gated webhook — enqueued IN-transaction but best-effort: a webhook failure
    // must NEVER roll back the record (mirrors the old fire-and-forget emit).
    if (a.emitSideEffects === true) {
      try {
        await enqueueWebhookEvent(
          ctx,
          a.orgId,
          "maintenance.created",
          {
            maintenanceId: a.recordId,
            title: a.title,
            assetIds,
            status: status ?? null,
            type: a.type ?? null,
          },
          a.now,
        );
      } catch {
        // swallow
      }
    }

    return { id: a.recordId };
  },
});

// ─── updateNative (parity with updateMaintenanceRecord) ─────────────────────
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    assetLinks: v.array(assetLinkArg), // desired full set; id used only for NEW links
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);

    const record = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_cuid", (q) => q.eq("id", a.id))
      .unique();
    if (!record || record.organizationId !== a.orgId) {
      throw new ConvexError("Maintenance record not found");
    }
    assertMaintenanceFields(a);

    // Validate reporter/assignee membership only when CHANGED, so a record whose original
    // reporter/assignee has since left the org can still be edited/re-saved.
    if (a.reportedById && a.reportedById !== record.reportedById) await assertMemberInOrg(ctx, a.orgId, a.reportedById);
    if (a.assignedToId && a.assignedToId !== record.assignedToId) await assertMemberInOrg(ctx, a.orgId, a.assignedToId);

    const links = await existingLinks(ctx, a.id);
    const existingAssetIds = links.map((l) => l.assetId).filter((id): id is string => id != null);
    const newAssetIds = Array.from(new Set(a.assetLinks.map((l) => l.assetId)));
    // Parity with the deleted server action's maintenanceSchema refinement: a record
    // must always retain at least one asset (an empty edit would release + unlink every
    // asset and leave an orphaned record).
    if (newAssetIds.length === 0) {
      throw new ConvexError("A maintenance record must have at least one asset");
    }

    const toRemove = existingAssetIds.filter((id) => !newAssetIds.includes(id));

    const wasHolding = isHoldingStatus(statusOf(record)); // BEFORE the patch
    const newStatus = a.status ?? "SCHEDULED";
    const isHolding = isHoldingStatus(newStatus);
    const willReleaseRemaining =
      newAssetIds.length > 0 &&
      wasHolding &&
      ((newStatus === "COMPLETED" && a.result !== "FAIL") || newStatus === "CANCELLED");

    // Cross-record still-held sets — computed while the current link/record state is
    // intact; every check excludes THIS record so its own links never self-hold.
    const removeStillHeld =
      toRemove.length > 0
        ? await computeStillHeldIds(ctx, a.orgId, toRemove, a.id)
        : new Set<string>();
    const remainingStillHeld = willReleaseRemaining
      ? await computeStillHeldIds(ctx, a.orgId, newAssetIds, a.id)
      : new Set<string>();

    // Transitions IN ORDER (parity L410-419). COMPLETED-FAIL deliberately does NOT
    // release (willReleaseRemaining is false) — the asset stays IN_MAINTENANCE.
    if (toRemove.length > 0) {
      await releaseAssets(ctx, a.orgId, toRemove, removeStillHeld, a.now);
    }
    if (newAssetIds.length > 0) {
      if (isHolding && !wasHolding) {
        await holdAssets(ctx, a.orgId, newAssetIds, a.now);
      }
      if (willReleaseRemaining) {
        await releaseAssets(ctx, a.orgId, newAssetIds, remainingStillHeld, a.now);
      }
    }

    // Patch the record. A field set to `undefined` CLEARS it (Convex db.patch
    // semantics) — parity with the old full-overwrite patch. organizationId is
    // never patched.
    await ctx.db.patch(record._id, {
      type: a.type,
      status: newStatus,
      title: a.title,
      description: a.description || undefined,
      reportedById: a.reportedById || undefined,
      assignedToId: a.assignedToId || undefined,
      scheduledDate: a.scheduledDate ?? undefined,
      completedDate: a.completedDate ?? undefined,
      cost: a.cost ?? undefined,
      partsUsed: a.partsUsed || undefined,
      photos: a.photos ?? [],
      result: a.result ?? undefined,
      nextDueDate: a.nextDueDate ?? undefined,
      tags: a.tags ?? [],
      updatedAt: a.now,
    });

    // Link diff: drop removed links, add the genuinely-new ones.
    for (const l of links) {
      if (l.assetId && toRemove.includes(l.assetId)) await ctx.db.delete(l._id);
    }
    for (const link of a.assetLinks) {
      if (existingAssetIds.includes(link.assetId)) continue;
      await insertLink(ctx, a.orgId, a.id, link.id, link.assetId);
    }

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "maintenance",
      entityId: a.id,
      entityName: a.title,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated maintenance record: ${a.title}`,
      createdAt: a.now,
    });

    return { id: a.id };
  },
});

// ─── deleteNative (parity with deleteMaintenanceRecord) ─────────────────────
export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const record = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_cuid", (q) => q.eq("id", a.id))
      .unique();
    if (!record || record.organizationId !== a.orgId) {
      throw new ConvexError("Record not found");
    }

    const links = await existingLinks(ctx, a.id);
    const linkedAssetIds = links.map((l) => l.assetId).filter((id): id is string => id != null);

    const holding = isHoldingStatus(statusOf(record));
    if (holding && linkedAssetIds.length > 0) {
      const stillHeld = await computeStillHeldIds(ctx, a.orgId, linkedAssetIds, a.id);
      await releaseAssets(ctx, a.orgId, linkedAssetIds, stillHeld, a.now);
    }

    await ctx.db.delete(record._id);
    // Re-implement the maintenanceRecord → maintenanceRecordAsset Cascade —
    // BOTH kinds (LINK + WS6 CHECKOFF), so a deleted record's progress history
    // doesn't orphan.
    for (const l of await allRecordAssetRows(ctx, a.id)) await ctx.db.delete(l._id);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "DELETE",
      entityType: "maintenance",
      entityId: a.id,
      entityName: record.title,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted maintenance record: ${record.title}`,
      details: { deleted: { title: record.title } },
      createdAt: a.now,
    });

    return { id: a.id };
  },
});
