import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { isConfirmedOrLater } from "./availabilityCore";
import { getProjectWindow } from "./projectWindow";
import { collectCapped } from "./pagination";

/**
 * The ONE definition of a kit's state (UX Phase 14, D75; owner ruling 2026-11-24: derive only
 * Incomplete / Reserved / Available and keep the physical statuses the warehouse writes).
 *
 *   RETIRED, CHECKED_OUT, IN_MAINTENANCE  stored lifecycle status (the warehouse and maintenance write them)
 *   INCOMPLETE                            DERIVED: a member is missing (below)
 *   RESERVED                              DERIVED: booked on a confirmed-or-later job that has not ended
 *   AVAILABLE                             everything else
 *
 * The stored `INCOMPLETE` is never read for state and is no longer written (`warehouseOps`
 * check-in of a MISSING kit writes AVAILABLE; its member assets go LOST, which is what this derives
 * from). A legacy kit that still stores `INCOMPLETE` but has no missing member reads as Available,
 * and shows up in `legacy` so the owner can see them (read-only report, no backfill).
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
  /** A stored `INCOMPLETE` the derivation does not confirm (for the read-only legacy report). */
  legacyIncomplete: boolean;
}

/** Pure: the members this kit is missing. */
export function missingMembers(serialized: KitSerializedMember[], bulk: KitBulkMember[]): KitMissingItem[] {
  const out: KitMissingItem[] = [];
  for (const m of serialized) {
    if (!m.asset) out.push({ kind: "asset", id: m.assetId, label: m.assetId, why: "missing" });
    else if (m.asset.status === "LOST") out.push({ kind: "asset", id: m.assetId, label: m.asset.assetTag, why: "lost" });
    else if (m.asset.isActive === false) out.push({ kind: "asset", id: m.assetId, label: m.asset.assetTag, why: "retired" });
  }
  for (const m of bulk) {
    if (!m.bulkAsset || m.bulkAsset.isActive === false) out.push({ kind: "bulk", id: m.bulkAssetId, label: m.bulkAsset?.assetTag ?? m.bulkAssetId, why: "missing" });
    else if ((m.bulkAsset.totalQuantity ?? 0) < m.required) out.push({ kind: "bulk", id: m.bulkAssetId, label: m.bulkAsset.assetTag, why: "short" });
  }
  return out;
}

/** Pure: the kit's state from its stored status, its members and any booking. */
export function deriveKitState(input: KitStateInput): KitState {
  const missing = missingMembers(input.serialized, input.bulk);
  const stored = input.kit.status ?? "AVAILABLE";
  const booking = input.booking ?? null;
  const key = stateKey(stored, input.kit.isActive === false, missing.length > 0, booking != null);
  return {
    key,
    missing,
    booking,
    blocksBooking: key === "IN_MAINTENANCE" || key === "INCOMPLETE",
    legacyIncomplete: stored === "INCOMPLETE" && missing.length === 0,
  };
}

function stateKey(stored: string, inactive: boolean, anyMissing: boolean, booked: boolean): KitStateKey {
  if (inactive || stored === "RETIRED") return "RETIRED";
  if (stored === "CHECKED_OUT") return "CHECKED_OUT";
  if (stored === "IN_MAINTENANCE") return "IN_MAINTENANCE";
  if (anyMissing) return "INCOMPLETE";
  return booked ? "RESERVED" : "AVAILABLE";
}

// ─── Loading (org-scoped, bounded) ───────────────────────────────────────────

/** Lines read per kit when looking for its booking. */
const BOOKING_LINES_CAP = 200;

interface KitMembers {
  serialized: KitSerializedMember[];
  bulk: KitBulkMember[];
}

/** Members of each kit. Reads the GLOBAL `by_kitId` indexes and re-checks the org on every row. */
export async function loadKitMembers(ctx: QueryCtx, orgId: string, kitIds: readonly string[]): Promise<Map<string, KitMembers>> {
  const out = new Map<string, KitMembers>();
  for (const kitId of kitIds) {
    const [ser, blk] = await Promise.all([
      collectCapped(ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), 500),
      collectCapped(ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), 500),
    ]);
    const serialized: KitSerializedMember[] = [];
    for (const m of ser.rows.filter((r) => r.organizationId === orgId)) {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", m.assetId)).first();
      serialized.push({ assetId: m.assetId, asset: a && a.organizationId === orgId ? { assetTag: a.assetTag, status: a.status, isActive: a.isActive } : null });
    }
    const bulk: KitBulkMember[] = [];
    for (const m of blk.rows.filter((r) => r.organizationId === orgId)) {
      const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", m.bulkAssetId)).first();
      bulk.push({ bulkAssetId: m.bulkAssetId, required: m.quantity, bulkAsset: b && b.organizationId === orgId ? { assetTag: b.assetTag, totalQuantity: b.totalQuantity, isActive: b.isActive } : null });
    }
    out.set(kitId, { serialized, bulk });
  }
  return out;
}

/**
 * The booking that reserves a kit: its parent line on the LIVE version of a confirmed-or-later job
 * that has not ended yet (the earliest start wins). Reads by_kitId (global) with an org re-check.
 */
export async function loadKitBookings(ctx: QueryCtx, orgId: string, kitIds: readonly string[], now: number): Promise<Map<string, KitBooking>> {
  const out = new Map<string, KitBooking>();
  const projects = new Map<string, Doc<"projects"> | null>();
  for (const kitId of kitIds) {
    const { rows } = await collectCapped(ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)), BOOKING_LINES_CAP);
    for (const li of rows) {
      if (li.organizationId !== orgId || li.isKitChild || li.status === "CANCELLED" || li.status === "RETURNED") continue;
      if (!projects.has(li.projectId)) {
        const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", li.projectId)).first();
        projects.set(li.projectId, p && p.organizationId === orgId ? p : null);
      }
      const p = projects.get(li.projectId);
      if (!p || p.isTemplate || !isConfirmedOrLater(p.status) || li.versionId == null || li.versionId !== p.liveVersionId) continue;
      const { start, end } = getProjectWindow(p);
      if (end != null && end < now) continue;
      const prior = out.get(kitId);
      if (!prior || (start ?? Infinity) < (prior.start ?? Infinity)) out.set(kitId, { projectId: p.id, projectNumber: p.projectNumber, projectName: p.name, start });
    }
  }
  return out;
}

/** States for a set of kits, in one pass. */
export async function loadKitStates(ctx: QueryCtx, orgId: string, kits: readonly Doc<"kits">[], now: number): Promise<Map<string, KitState>> {
  const ids = kits.map((k) => k.id);
  const [members, bookings] = await Promise.all([loadKitMembers(ctx, orgId, ids), loadKitBookings(ctx, orgId, ids, now)]);
  return new Map(
    kits.map((k) => [k.id, deriveKitState({ kit: k, serialized: members.get(k.id)?.serialized ?? [], bulk: members.get(k.id)?.bulk ?? [], booking: bookings.get(k.id) })]),
  );
}

/**
 * The booking gates' entry point (`lineItemWrites.addKit…`, `groupTemplatesWrites.applyNative`,
 * `kits.bookingState`): the kit's state WITHOUT the reservation read (a reservation never blocks;
 * the dated double-booking check owns that). One definition replaces the three stored-status tests.
 */
export async function loadKitBookingGate(ctx: QueryCtx, orgId: string, kit: Doc<"kits">): Promise<KitState> {
  const members = (await loadKitMembers(ctx, orgId, [kit.id])).get(kit.id);
  return deriveKitState({ kit, serialized: members?.serialized ?? [], bulk: members?.bulk ?? [] });
}

/** One kit's state. */
export async function loadKitState(ctx: QueryCtx, orgId: string, kit: Doc<"kits">, now: number): Promise<KitState> {
  return (await loadKitStates(ctx, orgId, [kit], now)).get(kit.id)!;
}
