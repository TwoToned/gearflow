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
/** #1080/#1101 — `subHire`/`subHireItem`/`subHireGroup`/`categorySlot` added
 *  so a version-viewing render can reproduce the live Equipment tab's exact
 *  table (sub-hire groups, and the `categorySlots`-driven combined order of
 *  project groups + sub-hire groups + standalone line items) instead of the
 *  simplified "not captured" fallback. Kept in lockstep with two other
 *  redeclarations of this union: `convex/projectLocksRead.ts`'s `ENTRY_RETURNS`
 *  and `src/lib/project-version-projection.ts`'s local type (R-3.1 — one closed
 *  union, never a silently-widened `v.string()`). `restoreProjectSnapshot`
 *  deliberately does NOT restore these four on `PROMOTE`/`FULL` — promoting an
 *  older version still leaves the project's CURRENT sub-hire orders/ordering
 *  in place; only VIEWING a captured version reflects its true historical
 *  state. See FEATUREDOCS/70's "Phase 6" section. */
export type SnapshotEntityType =
  | "project"
  | "category"
  | "group"
  | "lineItem"
  | "service"
  | "crewAssignment"
  | "subHire"
  | "subHireItem"
  | "subHireGroup"
  | "categorySlot";
/** `FINANCIAL`/`FULL` are the two unlock-session discard scopes (#791/#792).
 *  `PROMOTE` (#1080/#1089, Phase 2) is a third caller of this same mechanism —
 *  "make an older version live" — not an unlock at all, hence the type name
 *  staying `RestoreScope` rather than `UnlockScope`. */
export type RestoreScope = "FINANCIAL" | "FULL" | "PROMOTE";

function stripDoc(doc: Record<string, unknown> & { _id: unknown; _creationTime: unknown }): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

export interface SnapshotEntryLike {
  entityType: SnapshotEntityType;
  entityId: string;
  data: Record<string, unknown>;
}

interface SubHireRelatedEntities {
  subHires: Doc<"subHires">[];
  subHireItems: Doc<"subHireItems">[];
  subHireGroups: Doc<"subHireGroups">[];
  categorySlots: Doc<"categorySlots">[];
}

/** `subHireItems`/`subHireGroups`/`categorySlots` carry no `organizationId` —
 *  org-scope them transitively through `subHires`/`projectCategories`, which
 *  do. Shared by `captureProjectSnapshot` and `collectCurrentEntries` so the
 *  transitive-scoping logic exists once (R-3.1), mirroring the same
 *  referenced-only join pattern `convex/equipmentTab.ts`'s `readEquipmentTab`
 *  already uses for the live tab. */
async function collectSubHireRelatedEntities(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  categoryIds: string[],
): Promise<SubHireRelatedEntities> {
  const subHires = (
    await ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
  ).filter((s) => s.organizationId === orgId);
  const subHireIds = subHires.map((s) => s.id);

  const [itemArrays, groupArrays, slotArrays] = await Promise.all([
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
    Promise.all(categoryIds.map((id) => ctx.db.query("categorySlots").withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", id)).collect())),
  ]);

  return {
    subHires,
    subHireItems: itemArrays.flat(),
    subHireGroups: groupArrays.flat(),
    categorySlots: slotArrays.flat(),
  };
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

  const subHireRelated = await collectSubHireRelatedEntities(ctx, orgId, project.id, categories.map((c) => c.id));
  for (const s of subHireRelated.subHires) out.push({ entityType: "subHire", entityId: s.id, data: stripDoc(s) });
  for (const i of subHireRelated.subHireItems) out.push({ entityType: "subHireItem", entityId: i.id, data: stripDoc(i) });
  for (const g of subHireRelated.subHireGroups) out.push({ entityType: "subHireGroup", entityId: g.id, data: stripDoc(g) });
  for (const s of subHireRelated.categorySlots) out.push({ entityType: "categorySlot", entityId: s.id, data: stripDoc(s) });

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

  const subHireRelated = await collectSubHireRelatedEntities(ctx, orgId, project.id, categories.map((c) => c.id));
  for (const s of subHireRelated.subHires) await insertEntry("subHire", s.id, stripDoc(s));
  for (const i of subHireRelated.subHireItems) await insertEntry("subHireItem", i.id, stripDoc(i));
  for (const g of subHireRelated.subHireGroups) await insertEntry("subHireGroup", g.id, stripDoc(g));
  for (const s of subHireRelated.categorySlots) await insertEntry("categorySlot", s.id, stripDoc(s));

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

/** The most recent captured snapshot for a project at a specific revision, org-
 *  checked. A single revision can accumulate more than one capture over its
 *  lifetime (e.g. a `VERSION_SAVED` capture while still live, then `QUOTE_SENT`
 *  once it's sent) — captures are a versioned list, never overwritten (see the
 *  file header) — so "most recent" is the row reflecting the revision's state
 *  at the moment it actually stopped being live. Null when this revision has
 *  never been captured (not viewable, not restorable — #1080/#1085 §9). */
export async function findSnapshotForRevision(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  revision: number,
): Promise<Doc<"projectSnapshots"> | null> {
  const rows = (
    await ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
  ).filter((r) => r.organizationId === orgId && r.revision === revision);
  if (rows.length === 0) return null;
  return rows.reduce((latest, r) => (r.takenAt > latest.takenAt ? r : latest));
}

/** Ignore bookkeeping fields not meaningful to an equality check — mirrors
 *  `src/lib/project-snapshot-diff.ts`'s `hasChanged` (the Convex bundler can't
 *  resolve the `@/` alias — same "duplicated byte-for-byte, pinned by a
 *  cross-import equality test" pattern as `projectWindow.ts`; see
 *  `projectSnapshots.test.ts`). EXPORTED for that pin test. */
export function entryDataEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updatedAt");
  keys.delete("createdAt");
  for (const k of keys) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  }
  return true;
}

/** Same comparison `diffSnapshotEntries` (`src/lib/project-snapshot-diff.ts`)
 *  makes for the Versions UI, reduced to a boolean: are these two entry lists
 *  identical? The "project" entity is excluded, matching that function —
 *  project-row drift (dates, notes, etc.) doesn't by itself justify a fresh
 *  PRE_PROMOTE capture; category/group/lineItem/service/crewAssignment drift
 *  does. EXPORTED for the pin test (see `entryDataEqual` above). */
export function snapshotEntriesEqual(a: SnapshotEntryLike[], b: SnapshotEntryLike[]): boolean {
  const key = (e: SnapshotEntryLike) => `${e.entityType}:${e.entityId}`;
  const aMap = new Map(a.filter((e) => e.entityType !== "project").map((e) => [key(e), e]));
  const bMap = new Map(b.filter((e) => e.entityType !== "project").map((e) => [key(e), e]));
  if (aMap.size !== bMap.size) return false;
  for (const [k, entryA] of aMap) {
    const entryB = bMap.get(k);
    if (!entryB || !entryDataEqual(entryA.data, entryB.data)) return false;
  }
  return true;
}

/** Whether the project's CURRENT live state is byte-identical to an already-
 *  captured snapshot — the Phase 2 promote auto-capture skip rule (§3.4
 *  branch 3): nothing is at risk, so allocating a number for a byte-identical
 *  copy would just be dead-row noise in the version list. */
export async function liveStateMatchesCapturedSnapshot(
  ctx: MutationCtx,
  orgId: string,
  project: Doc<"projects">,
  snapshotId: string,
): Promise<boolean> {
  const current = await collectCurrentEntries(ctx, orgId, project);
  const capturedMap = await loadSnapshotEntryMap(ctx, orgId, snapshotId);
  const captured: SnapshotEntryLike[] = [...capturedMap.values()].map((e) => ({
    entityType: e.entityType,
    entityId: e.entityId,
    data: e.data as Record<string, unknown>,
  }));
  return snapshotEntriesEqual(current, captured);
}

/** Delete a captured snapshot and every one of its entry rows — the
 *  counterpart to `captureProjectSnapshot` (#1080/#1097 `deleteVersionNative`:
 *  a saved-but-never-sent version's capture has no other consumer once the
 *  version itself is deleted). Org-checked on both tables — `by_snapshotId`
 *  and `by_cuid` are global indexes. A missing or cross-org snapshot is a
 *  silent no-op rather than an error: `quote.snapshotId` can be absent (a
 *  never-sent draft that was never itself the outgoing side of a save), and
 *  the delete is best-effort cleanup, not the primary write. */
export async function deleteSnapshotAndEntries(
  ctx: MutationCtx,
  orgId: string,
  snapshotId: string,
): Promise<void> {
  const entries = (
    await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshotId)).collect()
  ).filter((e) => e.organizationId === orgId);
  for (const e of entries) await ctx.db.delete(e._id);

  const snapshot = await ctx.db.query("projectSnapshots").withIndex("by_cuid", (q) => q.eq("id", snapshotId)).first();
  if (snapshot && snapshot.organizationId === orgId) await ctx.db.delete(snapshot._id);
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

/**
 * Phase 2 (#1080/#1089) — `PROMOTE`'s project-row exclusion list (design
 * §3.5). Every OTHER captured project field restores; these don't, because
 * restoring them would undo the promote itself, contradict real-world state,
 * or fight the recalc pipeline that already owns them as a single writer
 * (R-3.1).
 */
const PROMOTE_EXCLUDED_PROJECT_FIELDS = new Set<string>([
  // Identity — never version-scoped.
  "id", "organizationId", "projectNumber", "isTemplate", "createdAt",
  // The counters themselves — restoring them would undo the promote.
  "revision", "liveRevision",
  // Lifecycle position is where the job actually IS, not what a version said.
  "status",
  // Real issued invoices / real money received — never rolled back.
  "invoicedTotal", "depositPaid",
  // Derived — recalc owns these; restoring then recalculating is two writers
  // for one value.
  "subtotal", "total", "taxAmount", "margin",
  "equipmentRevenue", "saleRevenue", "saleCostTotal",
  "serviceCostTotal", "labourCostTotal", "subHireCostTotal",
]);

export interface RestoreResult {
  /** Human-readable descriptions of entities the restore deliberately left
   *  untouched because reconciling them could contradict live warehouse state. */
  conflicts: string[];
}

export interface RestoreArgs {
  orgId: string;
  project: Doc<"projects">;
  snapshotId: string;
  scope: RestoreScope;
  now: number;
}

/**
 * Reconcile current project entities against a snapshot's captured state.
 * `scope: "FINANCIAL"` (#791 discard) touches ONLY the locked money fields —
 * structural changes made during the session (items added/removed) are never
 * rolled back; an item added during the session survives but its price fields
 * revert to $0/unset. `scope: "FULL"` (#792 discard) and `scope: "PROMOTE"`
 * (#1089, Phase 2 — "make an older version live") both additionally reconcile
 * structure: patch changed entities, recreate removed ones, remove added ones
 * — except where that would contradict live warehouse state (see
 * `isWarehouseBacked`), which is surfaced as a conflict instead of forced.
 * `PROMOTE` differs from `FULL` in exactly one place: the PROJECT ROW restores
 * the wide field set in `PROMOTE_EXCLUDED_PROJECT_FIELDS`'s complement (dates,
 * client, notes, duration-derived pricing overrides…) rather than just
 * `LOCKED_PROJECT_FIELDS` — every other entity type follows `FULL`'s rules
 * unchanged.
 */
export async function restoreProjectSnapshot(ctx: MutationCtx, args: RestoreArgs): Promise<RestoreResult> {
  const { orgId, project, snapshotId, scope, now } = args;
  const entries = await loadSnapshotEntryMap(ctx, orgId, snapshotId);
  const conflicts: string[] = [];
  // PROMOTE reconciles structure the same way FULL does — everywhere below
  // that branches on "structural restore", both scopes take the same path.
  const structural = scope === "FULL" || scope === "PROMOTE";

  // ── Project fields ──
  const projectEntry = entries.get(`project:${project.id}`);
  if (projectEntry) {
    const data = projectEntry.data as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: now };
    if (scope === "PROMOTE") {
      for (const [k, val] of Object.entries(data)) {
        if (PROMOTE_EXCLUDED_PROJECT_FIELDS.has(k)) continue;
        patch[k] = val;
      }
    } else {
      for (const f of LOCKED_PROJECT_FIELDS) patch[f] = data[f];
    }
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
      if (structural) {
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
      if (structural) {
        await ctx.db.delete(g._id);
      } else {
        await ctx.db.patch(g._id, { price: undefined, discount: undefined, pricedUnderLock: true, updatedAt: now });
      }
    }
  }
  if (structural) {
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
      if (structural) {
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
      if (structural) {
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
  if (structural) {
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
      if (structural) {
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
    } else if (structural) {
      await ctx.db.delete(s._id);
    } else if (!hasCrew) {
      await ctx.db.patch(s._id, { costTotal: 0, updatedAt: now });
    }
  }
  if (structural) {
    const currentIds = new Set(currentServices.map((s) => s.id));
    for (const [key, entry] of entries) {
      if (!key.startsWith("service:") || currentIds.has(entry.entityId)) continue;
      const data = entry.data as unknown as Record<string, unknown> & { _id: unknown; _creationTime: unknown };
      const { _id: _dropId, _creationTime: _dropTime, ...rest } = data;
      await ctx.db.insert("projectServices", { ...rest, updatedAt: now } as Doc<"projectServices">);
    }
  }

  // ── Crew assignments ── (rate/hours only — never rewrite workflow status)
  if (structural) {
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
