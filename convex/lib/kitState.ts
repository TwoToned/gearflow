import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { isConfirmedOrLater } from "./availabilityCore";
import { getProjectWindow } from "./projectWindow";
import { collectCapped } from "./pagination";
import { unlimitedBudget, type ReadBudget } from "./readBudget";

/**
 * The ONE definition of a kit's state (UX Phase 14, D75; owner ruling 2026-11-24: derive only
 * Incomplete / Reserved / Available and keep the physical statuses the warehouse writes).
 *
 *   RETIRED, CHECKED_OUT, IN_MAINTENANCE  stored lifecycle status (the warehouse and maintenance write them)
 *   INCOMPLETE                            DERIVED (a member is missing, below) OR the stored `INCOMPLETE`
 *   RESERVED                              DERIVED: booked on a confirmed-or-later job that has not ended
 *   AVAILABLE                             everything else
 *
 * The stored `INCOMPLETE` is the human-cleared "reported missing" marker (review ruling, D75 note): a
 * MISSING kit return writes it again (a bulk-only kit has no LOST status to derive from, because bulk
 * `totalQuantity` is never reduced by a return), and ONLY `kitWrites.markCompleteNative` ("Mark
 * complete", with an exact field-edit Undo) clears it. So a mixed kit stays Incomplete after its LOST
 * asset is set back to AVAILABLE until someone says it is whole again, and a legacy stored INCOMPLETE
 * row keeps blocking exactly as it did before this PR.
 *
 * A member is MISSING when: a serialised member's asset is gone, `LOST` or retired (`isActive:
 * false`); or a bulk member's bulk asset is gone or holds less in total than the kit needs.
 * A member in maintenance is "in repair", NOT missing.
 *
 * Precedence: RETIRED > CHECKED_OUT > IN_MAINTENANCE > INCOMPLETE > RESERVED > AVAILABLE, so a
 * missing item beats a reservation (`1 item missing … needed for #2341`).
 * `blocksBooking` is exactly what the three booking gates used to test with the stored status:
 * a kit that is IN_MAINTENANCE or INCOMPLETE cannot be added to a job.
 */

export type KitStateKey = "RETIRED" | "CHECKED_OUT" | "IN_MAINTENANCE" | "INCOMPLETE" | "RESERVED" | "AVAILABLE";

export interface KitMissingItem {
  kind: "asset" | "bulk";
  id: string;
  label: string;
  why: "missing" | "lost" | "retired" | "short";
}

export interface KitSerializedMember {
  assetId: string;
  /** Absent when the asset row is gone (or in another org). */
  asset: { assetTag: string; status?: string | null; isActive?: boolean | null } | null;
}

export interface KitBulkMember {
  bulkAssetId: string;
  /** What the kit needs. */
  required: number;
  bulkAsset: { assetTag: string; totalQuantity?: number | null; isActive?: boolean | null } | null;
}

export interface KitBooking {
  projectId: string;
  projectNumber: string;
  projectName: string;
  start: number | null;
}

export interface KitStateInput {
  kit: { status?: string | null; isActive?: boolean | null };
  serialized: KitSerializedMember[];
  bulk: KitBulkMember[];
  booking?: KitBooking | null;
}

export interface KitState {
  key: KitStateKey;
  missing: KitMissingItem[];
  booking: KitBooking | null;
  blocksBooking: boolean;
  /** The stored `INCOMPLETE` marker is set (cleared only by Mark complete). */
  reportedMissing: boolean;
}

/** Pure: the members this kit is missing. */
export function missingMembers(serialized: KitSerializedMember[], bulk: KitBulkMember[]): KitMissingItem[] {
  return [...serialized.map(serialMissing), ...bulk.map(bulkMissing)].filter((m): m is KitMissingItem => m != null);
}

function serialMissing(m: KitSerializedMember): KitMissingItem | null {
  const a = m.asset;
  const why = !a ? "missing" : a.status === "LOST" ? "lost" : a.isActive === false ? "retired" : null;
  return why ? { kind: "asset", id: m.assetId, label: a?.assetTag ?? m.assetId, why } : null;
}

function bulkMissing(m: KitBulkMember): KitMissingItem | null {
  const b = m.bulkAsset;
  const why = !b || b.isActive === false ? "missing" : (b.totalQuantity ?? 0) < m.required ? "short" : null;
  return why ? { kind: "bulk", id: m.bulkAssetId, label: b?.assetTag ?? m.bulkAssetId, why } : null;
}

/** Pure: the kit's state from its stored status, its members and any booking. */
export function deriveKitState(input: KitStateInput): KitState {
  const missing = missingMembers(input.serialized, input.bulk);
  const stored = input.kit.status ?? "AVAILABLE";
  const booking = input.booking ?? null;
  const reportedMissing = stored === "INCOMPLETE";
  const key = stateKey(stored, input.kit.isActive === false, missing.length > 0 || reportedMissing, booking != null);
  return {
    key,
    missing,
    booking,
    blocksBooking: key === "IN_MAINTENANCE" || key === "INCOMPLETE",
    reportedMissing,
  };
}

function stateKey(stored: string, inactive: boolean, incomplete: boolean, booked: boolean): KitStateKey {
  if (inactive || stored === "RETIRED") return "RETIRED";
  if (stored === "CHECKED_OUT") return "CHECKED_OUT";
  if (stored === "IN_MAINTENANCE") return "IN_MAINTENANCE";
  if (incomplete) return "INCOMPLETE";
  return booked ? "RESERVED" : "AVAILABLE";
}

// ─── Loading (org-scoped, bounded) ───────────────────────────────────────────

/** Lines read per kit when looking for its booking. */
const BOOKING_LINES_CAP = 200;

interface KitMembers {
  serialized: KitSerializedMember[];
  bulk: KitBulkMember[];
}

/** Rows one kit's member read may take (the per-kit ceiling; the call's budget can lower it). */
const MEMBER_ROWS_CAP = 500;

/**
 * One kit's members, drawn from the call's read budget (every row read and every member looked up is
 * charged). Reads the GLOBAL `by_kitId` indexes and re-checks the org on every row. `null` = the budget
 * could not cover this kit, so its state is unknown (never a guess).
 */
async function loadKitMembersOf(ctx: QueryCtx, orgId: string, kitId: string, budget: ReadBudget): Promise<KitMembers | null> {
  const rows = await readMemberRows(ctx, orgId, kitId, budget);
  if (!rows) return null;
  const { serRows, blkRows } = rows;
  if (budget.take(serRows.length + blkRows.length) < serRows.length + blkRows.length) return unaffordable(budget);
  const serialized: KitSerializedMember[] = [];
  for (const m of serRows) {
    const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", m.assetId)).first();
    serialized.push({ assetId: m.assetId, asset: a && a.organizationId === orgId ? { assetTag: a.assetTag, status: a.status, isActive: a.isActive } : null });
  }
  const bulk: KitBulkMember[] = [];
  for (const m of blkRows) {
    const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", m.bulkAssetId)).first();
    bulk.push({ bulkAssetId: m.bulkAssetId, required: m.quantity, bulkAsset: b && b.organizationId === orgId ? { assetTag: b.assetTag, totalQuantity: b.totalQuantity, isActive: b.isActive } : null });
  }
  return { serialized, bulk };
}

/** The kit's member rows (org re-checked), charged to the budget; `null` when the budget cannot cover them. */
async function readMemberRows(ctx: QueryCtx, orgId: string, kitId: string, budget: ReadBudget) {
  if (!budget.hasRoom) return unaffordable(budget);
  const room = Math.min(MEMBER_ROWS_CAP, budget.left);
  const [ser, blk] = await Promise.all([
    collectCapped(ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), room),
    collectCapped(ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), room),
  ]);
  budget.take(ser.rows.length + blk.rows.length);
  if ((ser.truncated || blk.truncated) && room < MEMBER_ROWS_CAP) return unaffordable(budget);
  return { serRows: ser.rows.filter((r) => r.organizationId === orgId), blkRows: blk.rows.filter((r) => r.organizationId === orgId) };
}

function unaffordable(budget: ReadBudget): null {
  budget.truncated = true;
  return null;
}

/**
 * The booking that reserves ONE kit: its parent line on the LIVE version of a confirmed-or-later job
 * that has not ended yet (the earliest start wins). Reads by_kitId (global) with an org re-check, drawn
 * from the budget. `undefined` = the budget could not cover it (unknown), `null` = not booked.
 */
async function loadKitBookingOf(ctx: QueryCtx, orgId: string, kitId: string, now: number, budget: ReadBudget, projects: Map<string, Doc<"projects"> | null>): Promise<KitBooking | null | undefined> {
  if (!budget.hasRoom) return void unaffordable(budget);
  const room = Math.min(BOOKING_LINES_CAP, budget.left);
  const { rows, truncated } = await collectCapped(ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), room);
  budget.take(rows.length);
  if (truncated && room < BOOKING_LINES_CAP) return void unaffordable(budget);
  let best: KitBooking | null = null;
  for (const li of rows.filter((r) => r.organizationId === orgId && isLiveParentKitLine(r))) {
    if (budget.take(1) < 1) return void unaffordable(budget);
    best = earlier(best, bookingOf(li, await orgProject(ctx, orgId, li.projectId, projects), now));
  }
  return best;
}

/** Pure: the booking with the earlier start (a booking with no start sorts last). */
function earlier(a: KitBooking | null, b: KitBooking | null): KitBooking | null {
  if (!b) return a;
  return !a || (b.start ?? Infinity) < (a.start ?? Infinity) ? b : a;
}

/** A kit's own (non-child) line that is not cancelled or already returned. */
const isLiveParentKitLine = (li: Doc<"projectLineItems">): boolean => !li.isKitChild && li.status !== "CANCELLED" && li.status !== "RETURNED";

/** The job, only when it is in this org (`by_cuid` is global), memoised per call. */
async function orgProject(ctx: QueryCtx, orgId: string, projectId: string, cache: Map<string, Doc<"projects"> | null>): Promise<Doc<"projects"> | null> {
  if (!cache.has(projectId)) {
    const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    cache.set(projectId, p && p.organizationId === orgId ? p : null);
  }
  return cache.get(projectId) ?? null;
}

/** Pure: the booking a parent kit line makes on its job, or null when it does not reserve (template, not confirmed, not the live version, ended). */
function bookingOf(li: Doc<"projectLineItems">, p: Doc<"projects"> | null | undefined, now: number): KitBooking | null {
  if (!p || p.isTemplate || !isConfirmedOrLater(p.status)) return null;
  if (li.versionId == null || li.versionId !== p.liveVersionId) return null;
  const { start, end } = getProjectWindow(p);
  return end != null && end < now ? null : { projectId: p.id, projectNumber: p.projectNumber, projectName: p.name, start };
}

/**
 * States for a set of kits, drawn from ONE read budget for the whole call (`budget.truncated` is set
 * when it bites). A kit the budget could not cover maps to `null`: its state is unknown, never guessed.
 */
export async function loadKitStates(ctx: QueryCtx, orgId: string, kits: readonly Doc<"kits">[], now: number, budget: ReadBudget): Promise<Map<string, KitState | null>> {
  const out = new Map<string, KitState | null>();
  const projects = new Map<string, Doc<"projects"> | null>();
  for (const k of kits) {
    const members = await loadKitMembersOf(ctx, orgId, k.id, budget);
    const booking = members ? await loadKitBookingOf(ctx, orgId, k.id, now, budget, projects) : undefined;
    out.set(k.id, members && booking !== undefined ? deriveKitState({ kit: k, serialized: members.serialized, bulk: members.bulk, booking }) : null);
  }
  return out;
}

/**
 * The booking gates' entry point (`lineItemWrites.addKit…`, `groupTemplatesWrites.applyNative`,
 * `kits.bookingState`): the kit's state WITHOUT the reservation read (a reservation never blocks;
 * the dated double-booking check owns that). One definition replaces the three stored-status tests.
 * ONE kit, so it is not budgeted: a gate must never answer "unknown".
 */
export async function loadKitBookingGate(ctx: QueryCtx, orgId: string, kit: Doc<"kits">): Promise<KitState> {
  const members = await loadKitMembersOf(ctx, orgId, kit.id, unlimitedBudget());
  return deriveKitState({ kit, serialized: members?.serialized ?? [], bulk: members?.bulk ?? [] });
}
