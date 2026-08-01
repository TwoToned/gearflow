import { createId } from "@paralleldrive/cuid2";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { LOCKED_GROUP_FIELDS, LOCKED_LINE_ITEM_FIELDS, LOCKED_PROJECT_FIELDS, LOCKED_SERVICE_FIELDS } from "./projectLocks";

/**
 * Whole-project snapshot capture + restore (#792's shared mechanism — #791's
 * FINANCIAL-discard and #792's FULL-discard both call `restoreProjectSnapshot`
 * with a different `scope`). Storage is PARENT ROW (`projectSnapshots`) + PER-
 * ENTITY ROWS (`projectSnapshotEntries`), not one JSON blob — a single blob risks
 * Convex's ~1MB doc limit on large projects, and per-entity rows make diffing a
 * queryable join instead of a client-side JSON walk.
 */

/** #986 added QUOTE_SENT — the frozen entity state for a quote revision, taken by
 *  `quotesWrites.sendNative`. #1085 added VERSION_SAVED (an explicit Save
 *  version, or `newVersionNative` capturing the revision it moves past) and
 *  PRE_PROMOTE (Phase 2's auto-capture before a promote overwrites the live
 *  state) — all three carry a `revision`, unlike the status-driven reasons. */
export type SnapshotReason = "CONFIRMED" | "COMPLETED" | "UNLOCK" | "QUOTE_SENT" | "VERSION_SAVED" | "PRE_PROMOTE";
export type SnapshotEntityType = "project" | "category" | "group" | "lineItem" | "service" | "crewAssignment";
export type UnlockScope = "FINANCIAL" | "FULL";

function stripDoc(doc: Record<string, unknown> & { _id: unknown; _creationTime: unknown }): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

export interface SnapshotEntryLike {
  entityType: SnapshotEntityType;
  entityId: string;
  data: Record<string, unknown>;
}

/** Read-only: the SAME entity set/shape `captureProjectSnapshot` would write,
 *  without writing anything — lets the Versions UI diff "snapshot ↔ current"
 *  through the identical shape as "snapshot ↔ snapshot" (one diff code path,
 *  see src/lib/project-snapshot-diff.ts). Safe on a QueryCtx. */
export async function collectCurrentEntries(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  project: Doc<"projects">,
): Promise<SnapshotEntryLike[]> {
  const out: SnapshotEntryLike[] = [];
  out.push({ entityType: "project", entityId: project.id, data: stripDoc(project as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown }) });

  const categories = (
    await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((c) => c.organizationId === orgId);
  for (const c of categories) out.push({ entityType: "category", entityId: c.id, data: stripDoc(c) });

  const groups = (
    await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((g) => g.organizationId === orgId);
  for (const g of groups) out.push({ entityType: "group", entityId: g.id, data: stripDoc(g) });

  const lineItems = (
    await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((li) => li.organizationId === orgId);
  for (const li of lineItems) out.push({ entityType: "lineItem", entityId: li.id, data: stripDoc(li) });

  const services = (
    await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((s) => s.organizationId === orgId);
  for (const s of services) out.push({ entityType: "service", entityId: s.id, data: stripDoc(s) });

  const crew = (
    await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((c) => c.organizationId === orgId);
  for (const c of crew) out.push({ entityType: "crewAssignment", entityId: c.id, data: stripDoc(c) });

  return out;
}

export interface CaptureSnapshotArgs {
  orgId: string;
  project: Doc<"projects">;
  reason: SnapshotReason;
  /** The `projects.revision` this snapshot freezes. Set for QUOTE_SENT so the
   *  quote row and its snapshot share one number; omitted for the status-driven
   *  reasons, which aren't revision-scoped. */
  revision?: number;
  statusFrom?: string;
  statusTo?: string;
  actor: { userId: string; userName: string };
  now: number;
}

/** Capture project + categories + groups + line items + services + crew
 *  assignments as one versioned snapshot. Returns the new snapshotId. Never
 *  overwrites a prior snapshot — every capture is a new row (versioned list). */
export async function captureProjectSnapshot(ctx: MutationCtx, args: CaptureSnapshotArgs): Promise<string> {
  const { orgId, project, reason, revision, statusFrom, statusTo, actor, now } = args;
  const snapshotId = createId();

  await ctx.db.insert("projectSnapshots", {
    id: snapshotId,
    organizationId: orgId,
    projectId: project.id,
    reason,
    revision,
    takenAt: now,
    takenBy: actor.userId,
    takenByName: actor.userName,
    statusFrom,
    statusTo,
  });

  const insertEntry = async (entityType: SnapshotEntityType, entityId: string, data: Record<string, unknown>) => {
    await ctx.db.insert("projectSnapshotEntries", {
      id: createId(),
      organizationId: orgId,
      snapshotId,
      entityType,
      entityId,
      data,
    });
  };

  await insertEntry("project", project.id, stripDoc(project as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown }));

  const categories = (
    await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((c) => c.organizationId === orgId);
  for (const c of categories) await insertEntry("category", c.id, stripDoc(c));

  const groups = (
    await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((g) => g.organizationId === orgId);
  for (const g of groups) await insertEntry("group", g.id, stripDoc(g));

  const lineItems = (
    await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((li) => li.organizationId === orgId);
  for (const li of lineItems) await insertEntry("lineItem", li.id, stripDoc(li));

  const services = (
    await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((s) => s.organizationId === orgId);
  for (const s of services) await insertEntry("service", s.id, stripDoc(s));

  const crew = (
    await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((c) => c.organizationId === orgId);
  for (const c of crew) await insertEntry("crewAssignment", c.id, stripDoc(c));

  return snapshotId;
}

/** Load a snapshot's entries org-checked, indexed by `${entityType}:${entityId}`. */
export async function loadSnapshotEntryMap(
  ctx: MutationCtx,
  orgId: string,
  snapshotId: string,
): Promise<Map<string, Doc<"projectSnapshotEntries">>> {
  const entries = (
    await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshotId)).collect()
  ).filter((e) => e.organizationId === orgId);
  const map = new Map<string, Doc<"projectSnapshotEntries">>();
  for (const e of entries) map.set(`${e.entityType}:${e.entityId}`, e);
  return map;
}

/** Structural/workflow fields that reflect REAL warehouse state, never rewritten
 *  by a restore (asset/kit status is real-world truth — CLAUDE.md/#792 invariant). */
const LINE_ITEM_WAREHOUSE_FIELDS = new Set([
  "status", "returnStatus", "prepStatus", "prepContainer", "returnCondition", "returnNotes",
  "checkedOutQuantity", "returnedQuantity", "assignedQuantity", "packedQuantity",
  "damagedQuantity", "lostQuantity", "checkedOutAt", "checkedOutById", "returnedAt", "returnedById",
]);
const CREW_WORKFLOW_FIELDS = new Set([
  "status", "confirmedAt", "confirmedById", "responseToken", "offeredAt", "respondedAt", "responseNote",
]);

/** A line item/asset-backed entity is only auto-recreated/auto-deleted by a FULL
 *  restore when it carries no asset/bulkAsset/kit reference — those are left as
 *  conflicts for a human to reconcile rather than silently rewritten, since the
 *  physical item may have moved on to another job since the snapshot was taken
 *  (#792: "if a restore would contradict warehouse reality, surface a conflict"). */
function isWarehouseBacked(data: Record<string, unknown>): boolean {
  return data.assetId != null || data.bulkAssetId != null || data.kitId != null;
}

export interface RestoreResult {
  /** Human-readable descriptions of entities the restore deliberately left
   *  untouched because reconciling them could contradict live warehouse state. */
  conflicts: string[];
}

export interface RestoreArgs {
  orgId: string;
  project: Doc<"projects">;
  snapshotId: string;
  scope: UnlockScope;
  now: number;
}

/**
 * Reconcile current project entities against a snapshot's captured state.
 * `scope: "FINANCIAL"` (#791 discard) touches ONLY the locked money fields —
 * structural changes made during the session (items added/removed) are never
 * rolled back; an item added during the session survives but its price fields
 * revert to $0/unset. `scope: "FULL"` (#792 discard) additionally reconciles
 * structure: patches changed entities, recreates removed ones, and removes
 * added ones — except where that would contradict live warehouse state (see
 * `isWarehouseBacked`), which is surfaced as a conflict instead of forced.
 */
export async function restoreProjectSnapshot(ctx: MutationCtx, args: RestoreArgs): Promise<RestoreResult> {
  const { orgId, project, snapshotId, scope, now } = args;
  const entries = await loadSnapshotEntryMap(ctx, orgId, snapshotId);
  const conflicts: string[] = [];

  // ── Project fields ──
  const projectEntry = entries.get(`project:${project.id}`);
  if (projectEntry) {
    const data = projectEntry.data as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: now };
    for (const f of LOCKED_PROJECT_FIELDS) patch[f] = data[f];
    await ctx.db.patch(project._id, patch);
  }

  // ── Groups ──
  const currentGroups = (
    await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((g) => g.organizationId === orgId);
  for (const g of currentGroups) {
    const entry = entries.get(`group:${g.id}`);
    if (entry) {
      const data = entry.data as Record<string, unknown>;
      if (scope === "FULL") {
        const { _id: _dropId, _creationTime: _dropTime, id: _dropCuid, organizationId: _dropOrg, ...rest } = data as Record<string, unknown> & { id: string; organizationId: string };
        await ctx.db.replace(g._id, { ...rest, id: g.id, organizationId: orgId, updatedAt: now } as typeof g);
      } else {
        // Restoring a real historical price is a deliberate act — not a lock artifact.
        const patch: Record<string, unknown> = { updatedAt: now, pricedUnderLock: false };
        for (const f of LOCKED_GROUP_FIELDS) patch[f] = data[f];
        await ctx.db.patch(g._id, patch);
      }
    } else {
      // Added during the session, absent from the snapshot: same "not deliberately
      // priced" state `assertLifecycleGuard`'s `defaultToZero` produces on a locked
      // insert — flag it so the Unpriced badge points at the real cause.
      if (scope === "FULL") {
        await ctx.db.delete(g._id);
      } else {
        await ctx.db.patch(g._id, { price: undefined, discount: undefined, pricedUnderLock: true, updatedAt: now });
      }
    }
  }
  if (scope === "FULL") {
    const currentIds = new Set(currentGroups.map((g) => g.id));
    for (const [key, entry] of entries) {
      if (!key.startsWith("group:") || currentIds.has(entry.entityId)) continue;
      const data = entry.data as Doc<"projectGroups">;
      const { _id: _dropId, _creationTime: _dropTime, ...rest } = data as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown };
      await ctx.db.insert("projectGroups", { ...rest, updatedAt: now } as typeof data);
    }
  }

  // ── Line items ── (never touch warehouse-backed structure automatically)
  const currentLines = (
    await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((li) => li.organizationId === orgId);
  for (const li of currentLines) {
    const entry = entries.get(`lineItem:${li.id}`);
    if (entry) {
      const data = entry.data as Record<string, unknown>;
      if (scope === "FULL") {
        const patch: Record<string, unknown> = { updatedAt: now };
        for (const [k, v] of Object.entries(data)) {
          if (LINE_ITEM_WAREHOUSE_FIELDS.has(k) || k === "id" || k === "organizationId" || k === "projectId") continue;
          patch[k] = v;
        }
        await ctx.db.patch(li._id, patch);
      } else {
        // Restoring a real historical price is a deliberate act — not a lock artifact.
        const patch: Record<string, unknown> = { updatedAt: now, pricedUnderLock: false };
        for (const f of LOCKED_LINE_ITEM_FIELDS) patch[f] = data[f];
        await ctx.db.patch(li._id, patch);
      }
    } else {
      // Added during the session, absent from the snapshot: same "not deliberately
      // priced" state `assertLifecycleGuard`'s `defaultToZero` produces on a locked
      // insert — flag it so the Unpriced badge points at the real cause.
      if (scope === "FULL") {
        if (isWarehouseBacked(li as unknown as Record<string, unknown>)) {
          conflicts.push(`Line item "${li.description ?? li.id}" was added during the session and references live warehouse stock — review and remove manually.`);
        } else {
          await ctx.db.delete(li._id);
        }
      } else {
        await ctx.db.patch(li._id, { unitPrice: 0, discount: undefined, pricedUnderLock: true, updatedAt: now });
      }
    }
  }
  if (scope === "FULL") {
    const currentIds = new Set(currentLines.map((li) => li.id));
    for (const [key, entry] of entries) {
      if (!key.startsWith("lineItem:") || currentIds.has(entry.entityId)) continue;
      const data = entry.data as Record<string, unknown>;
      if (isWarehouseBacked(data)) {
        conflicts.push(`Line item "${data.description ?? entry.entityId}" was removed during the session and references warehouse stock that may have moved on — review and re-add manually if needed.`);
        continue;
      }
      const { _id: _dropId, _creationTime: _dropTime, ...rest } = data as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown };
      await ctx.db.insert("projectLineItems", { ...rest, updatedAt: now } as Doc<"projectLineItems">);
    }
  }

  // ── Services ── (costTotal restore only applies to crew-less services — a
  // crew-attached service's cost is re-derived by recalcServiceCostFromCrew and
  // shouldn't be overwritten with a stale snapshot value)
  const currentServices = (
    await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
  ).filter((s) => s.organizationId === orgId);
  const crewByService = new Set(
    (await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect())
      .filter((c) => c.organizationId === orgId && c.serviceId)
      .map((c) => c.serviceId as string),
  );
  for (const s of currentServices) {
    const entry = entries.get(`service:${s.id}`);
    const hasCrew = crewByService.has(s.id);
    if (entry) {
      const data = entry.data as Record<string, unknown>;
      if (scope === "FULL") {
        const patch: Record<string, unknown> = { updatedAt: now };
        for (const [k, v] of Object.entries(data)) {
          if (k === "id" || k === "organizationId" || k === "projectId") continue;
          if (k === "costTotal" && hasCrew) continue;
          patch[k] = v;
        }
        await ctx.db.patch(s._id, patch);
      } else {
        const patch: Record<string, unknown> = { updatedAt: now };
        for (const f of LOCKED_SERVICE_FIELDS) {
          if (f === "costTotal" && hasCrew) continue;
          patch[f] = data[f];
        }
        await ctx.db.patch(s._id, patch);
      }
    } else if (scope === "FULL") {
      await ctx.db.delete(s._id);
    } else if (!hasCrew) {
      await ctx.db.patch(s._id, { costTotal: 0, updatedAt: now });
    }
  }
  if (scope === "FULL") {
    const currentIds = new Set(currentServices.map((s) => s.id));
    for (const [key, entry] of entries) {
      if (!key.startsWith("service:") || currentIds.has(entry.entityId)) continue;
      const data = entry.data as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown };
      const { _id: _dropId, _creationTime: _dropTime, ...rest } = data;
      await ctx.db.insert("projectServices", { ...rest, updatedAt: now } as Doc<"projectServices">);
    }
  }

  // ── Crew assignments ── (rate/hours only — never rewrite workflow status)
  if (scope === "FULL") {
    const currentCrew = (
      await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect()
    ).filter((c) => c.organizationId === orgId);
    for (const c of currentCrew) {
      const entry = entries.get(`crewAssignment:${c.id}`);
      if (entry) {
        const data = entry.data as Record<string, unknown>;
        const patch: Record<string, unknown> = { updatedAt: now };
        for (const [k, v] of Object.entries(data)) {
          if (CREW_WORKFLOW_FIELDS.has(k) || k === "id" || k === "organizationId" || k === "projectId") continue;
          patch[k] = v;
        }
        await ctx.db.patch(c._id, patch);
      } else {
        conflicts.push(`Crew assignment for "${c.crewMemberId}" was added during the session — review and remove manually if not intended.`);
      }
    }
    const currentIds = new Set(currentCrew.map((c) => c.id));
    for (const [key, entry] of entries) {
      if (!key.startsWith("crewAssignment:") || currentIds.has(entry.entityId)) continue;
      conflicts.push(`Crew assignment removed during the session (entity ${entry.entityId}) was not automatically restored — review and re-add manually if needed.`);
    }
  }

  return { conflicts };
}
