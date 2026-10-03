import { createId } from "@paralleldrive/cuid2";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { liveRows } from "./versionScope";

/**
 * Whole-project snapshot CAPTURE (#792). Storage is PARENT ROW
 * (`projectSnapshots`) + PER-ENTITY ROWS (`projectSnapshotEntries`), not one
 * JSON blob — a single blob risks Convex's ~1MB doc limit on large projects,
 * and per-entity rows make diffing a queryable join instead of a client-side
 * JSON walk.
 *
 * #1230 (Phase 4, "Project versioning v2" parent #1221) deleted this module's
 * RESTORE half (`restoreProjectSnapshot`/`RestoreScope`/`RestoreArgs`/
 * `RestoreResult` and their `LOCKED_*_FIELDS`-diffing helpers) as dead code —
 * its only callers were the unlock-session discard flow
 * (`projectUnlockSessionsWrites.discardNative`, deleted this phase) and the
 * `PROMOTE` scope, whose own caller (`promoteRevisionNative`) was already
 * deleted in Phase 3 (#1229). A captured snapshot is still read (never
 * mutated back onto live rows) by the version-viewing/diff surfaces below.
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
 *  simplified "not captured" fallback. Kept in lockstep with
 *  `convex/projectLocksRead.ts`'s `ENTRY_RETURNS` redeclaration of this union
 *  (R-3.1 — one closed union, never a silently-widened `v.string()`). See
 *  FEATUREDOCS/70's "Phase 6" section. (`src/lib/project-version-projection.ts`,
 *  the switcher-UI's own copy of this union, was deleted in Phase 5 of
 *  Project Versioning v2, #1231 — the switcher no longer projects from
 *  snapshots.) */
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
    // VERSION-SCOPE: safe — categorySlots has no versionId of its own — reached only through an already version-scoped parent row (projectCategoryId/projectGroupId/subHireGroupId/lineItemId); see categorySlots' schema.ts comment.
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

  // LIVE-ONLY (#1228): this snapshot mechanism captures/restores the
  // project's CURRENT live plan only — it is unrelated to the new
  // `projectVersions` table's own non-live versions (see FEATUREDOCS/78's
  // callout on the two separate programs).
  const categories = (await liveRows(ctx, project, "projectCategories")).filter((c) => c.organizationId === orgId);
  for (const c of categories) out.push({ entityType: "category", entityId: c.id, data: stripDoc(c) });

  const groups = (await liveRows(ctx, project, "projectGroups")).filter((g) => g.organizationId === orgId);
  for (const g of groups) out.push({ entityType: "group", entityId: g.id, data: stripDoc(g) });

  const lineItems = (await liveRows(ctx, project, "projectLineItems")).filter((li) => li.organizationId === orgId);
  for (const li of lineItems) out.push({ entityType: "lineItem", entityId: li.id, data: stripDoc(li) });

  const services = (await liveRows(ctx, project, "projectServices")).filter((s) => s.organizationId === orgId);
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

  // LIVE-ONLY (#1228) — see the identical note on collectCurrentEntries above.
  const categories = (await liveRows(ctx, project, "projectCategories")).filter((c) => c.organizationId === orgId);
  for (const c of categories) await insertEntry("category", c.id, stripDoc(c));

  const groups = (await liveRows(ctx, project, "projectGroups")).filter((g) => g.organizationId === orgId);
  for (const g of groups) await insertEntry("group", g.id, stripDoc(g));

  const lineItems = (await liveRows(ctx, project, "projectLineItems")).filter((li) => li.organizationId === orgId);
  for (const li of lineItems) await insertEntry("lineItem", li.id, stripDoc(li));

  const services = (await liveRows(ctx, project, "projectServices")).filter((s) => s.organizationId === orgId);
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

