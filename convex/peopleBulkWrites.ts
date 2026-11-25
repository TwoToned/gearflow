import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { assertBulkSizeOk, enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertTags } from "./lib/fieldGuards";
import { bumpCrewMemberCounters } from "./lib/counters";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { collectCapped } from "./lib/pagination";

/**
 * The People lists' bulk writes with SERVER-side exact Undo (UX Phase 13, review of slice 1):
 * `Add tag…`, `Deactivate` / `Archive` / `Reactivate`, for crew members, clients and suppliers.
 *
 * Each forward write is ONE transaction that, per changed record, writes the record AND one
 * `recordFieldEdit` audit row (before / after of only the field that changed, the author, the
 * SERVER clock). The Undo takes only `{ id, auditId }` pairs: per record it runs the shared
 * `undoFieldEdit` (author-scoped, inside the server window, once via an `undo:` marker, and a
 * per-field compare-and-set so a later edit by anyone is never clobbered). A record that
 * changed since stays, and is NAMED in the result. There is no client snapshot to write back.
 * A tag Undo therefore only ever removes the tag THIS write added: it restores the tag list
 * exactly as it was, and only while the list is still exactly as this write left it.
 *
 * Per-row gates run server-side and are named, never thrown: a crew member holding a CONFIRMED
 * call, a client with an open job, an unknown / foreign / already-in-that-state record.
 */
type Kind = "crew" | "client" | "supplier";
const KIND = v.union(v.literal("crew"), v.literal("client"), v.literal("supplier"));
const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const pair = v.object({ id: v.string(), auditId: v.string() });
const MAX_ITEMS = 500;

interface Cfg { table: "crewMembers" | "clients" | "suppliers"; resource: "crew" | "client" | "supplier"; entityType: string; field: "status" | "isActive"; mutationGuard: string }
const CFG: Record<Kind, Cfg> = {
  crew: { table: "crewMembers", resource: "crew", entityType: "crew_member", field: "status", mutationGuard: "crew" },
  client: { table: "clients", resource: "client", entityType: "client", field: "isActive", mutationGuard: "client" },
  supplier: { table: "suppliers", resource: "supplier", entityType: "supplier", field: "isActive", mutationGuard: "supplier" },
};

type Row = { _id: never; id: string; organizationId: string; tags?: string[]; status?: string; isActive?: boolean; name?: string; firstName?: string; lastName?: string } & Record<string, unknown>;

async function loadRow(ctx: MutationCtx, cfg: Cfg, id: string, orgId: string): Promise<Row | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (await ctx.db.query(cfg.table).withIndex("by_cuid" as any, (q: any) => q.eq("id", id)).first()) as Row | null;
  return row && row.organizationId === orgId ? row : null; // by_cuid is global: org-check every row
}

const nameOf = (r: Row) => r.name ?? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();

async function patchRow(ctx: MutationCtx, cfg: Cfg, row: Row, patch: Record<string, unknown>, now: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ctx.db.patch(row._id as any, { ...patch, updatedAt: now } as any);
}

async function bumpCrew(ctx: MutationCtx, kind: Kind, orgId: string, before: Row, after: Record<string, unknown>) {
  if (kind === "crew") await bumpCrewMemberCounters(ctx, orgId, before as never, { ...before, ...after } as never);
}

const GATE_CAP = 2000;
const TOO_MANY = "too many records to check";

/** Why this record must be skipped (named in the result), or null. Server-side per-row gates. */
async function skipReason(ctx: MutationCtx, kind: Kind, orgId: string, row: Row, to: "off" | "on", todayMs: number): Promise<string | null> {
  if (to === "on") return null;
  if (kind === "crew") {
    const { rows, truncated } = await collectCapped(ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", row.id)), GATE_CAP);
    if (truncated) return TOO_MANY; // an unreadable tail must never let Archive through
    const confirmed = rows.some((c) => c.organizationId === orgId && c.status === "CONFIRMED" && (c.endDate ?? c.startDate ?? todayMs) >= todayMs);
    return confirmed ? "has a confirmed call" : null;
  }
  if (kind === "client") {
    const { rows, truncated } = await collectCapped(ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", row.id)), GATE_CAP);
    if (truncated) return TOO_MANY;
    const open = rows.some((p) => p.organizationId === orgId && !p.isTemplate && !["COMPLETED", "INVOICED", "CANCELLED"].includes(p.status ?? ""));
    return open ? "has open jobs" : null;
  }
  return null;
}

const base = { orgId: v.string(), kind: KIND, now: v.number(), actor: actorValidator };

interface Outcome { changed: { id: string; auditId: string }[]; skipped: { id: string; name: string; reason: string }[] }

async function runPatch(
  ctx: MutationCtx,
  a: { orgId: string; kind: Kind; items: { id: string; auditId: string }[]; now: number; actor: { userId: string; userName: string } },
  fieldsOf: (row: Row) => string[],
  nextOf: (row: Row) => Record<string, unknown> | string,
  summary: (row: Row) => string,
  gate?: (row: Row) => Promise<string | null>,
): Promise<Outcome> {
  const cfg = CFG[a.kind];
  const out: Outcome = { changed: [], skipped: [] };
  const seen = new Set<string>();
  for (const it of a.items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const row = await loadRow(ctx, cfg, it.id, a.orgId);
    if (!row) { out.skipped.push({ id: it.id, name: it.id, reason: "not found" }); continue; }
    const why = gate ? await gate(row) : null;
    if (why) { out.skipped.push({ id: it.id, name: nameOf(row), reason: why }); continue; }
    const next = nextOf(row);
    if (typeof next === "string") { out.skipped.push({ id: it.id, name: nameOf(row), reason: next }); continue; }
    const diff = diffFields(row, { ...row, ...next }, fieldsOf(row));
    if (!diff) { out.skipped.push({ id: it.id, name: nameOf(row), reason: "nothing to change" }); continue; }
    await patchRow(ctx, cfg, row, next, a.now);
    await bumpCrew(ctx, a.kind, a.orgId, row, next);
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: cfg.entityType, entityId: row.id, entityName: nameOf(row), auditId: it.auditId, actor: a.actor, now: a.now, diff, summary: summary(row) });
    out.changed.push(it);
  }
  return out;
}

const outcomeValidator = v.object({
  changed: v.array(pair),
  skipped: v.array(v.object({ id: v.string(), name: v.string(), reason: v.string() })),
});

async function guards(ctx: MutationCtx, kind: Kind, orgId: string, count: number, a: { actor: { userId: string; userName: string } }) {
  if (count > MAX_ITEMS) throw new ConvexError(`Too many at once (max ${MAX_ITEMS}).`);
  await assertWritesEnabled(ctx, CFG[kind].mutationGuard as never);
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, CFG[kind].resource, "update");
  await assertBulkSizeOk(ctx, count);
  return await resolveActor(ctx, a.actor);
}

/** Add ONE tag to each record (kept to the shared tag bounds), recording the exact change per record. */
export const addTagManyNative = mutation({
  returns: outcomeValidator,
  args: { ...base, items: v.array(pair), tag: v.string() },
  handler: async (ctx, a) => {
    const actor = await guards(ctx, a.kind, a.orgId, a.items.length, a);
    const tag = (assertTags([a.tag])?.[0] ?? "").toLowerCase();
    if (!tag) throw new ConvexError("Enter a tag.");
    return runPatch(
      ctx, { ...a, actor }, () => ["tags"],
      (row) => (row.tags ?? []).includes(tag) ? `already tagged ${tag}` : assertTagRoom(row.tags ?? [], tag),
      (row) => `Tagged ${nameOf(row)} ${tag}`,
    );
  },
});

function assertTagRoom(tags: string[], tag: string): Record<string, unknown> | string {
  try {
    return { tags: assertTags([...tags, tag]) ?? [...tags, tag] };
  } catch {
    return "already has the maximum number of tags";
  }
}

/**
 * Deactivate (crew `INACTIVE`) / Archive (client, supplier `isActive:false`) or Reactivate.
 * `high`: it takes a person or a company out of the pickers. Exactly reversible by
 * `undoManyNative`.
 */
export const setActiveManyNative = mutation({
  returns: outcomeValidator,
  args: { ...base, items: v.array(pair), active: v.boolean(), todayMs: v.number() },
  handler: async (ctx, a) => {
    const actor = await guards(ctx, a.kind, a.orgId, a.items.length, a);
    const cfg = CFG[a.kind];
    const todayMs = Math.min(a.todayMs, Date.now() + 86_400_000);
    const to = a.active ? "on" : "off";
    const value = cfg.field === "status" ? (a.active ? "ACTIVE" : "INACTIVE") : a.active;
    /** A crew row the list shows as inactive because of a legacy `isActive:false`, whatever its `status`. */
    const legacyInactive = (row: Row) => a.kind === "crew" && row.isActive === false;
    const verb = a.kind === "crew" ? (a.active ? "Reactivated" : "Deactivated") : a.active ? "Reactivated" : "Archived";
    return runPatch(
      ctx, { ...a, actor }, (row) => (a.active && legacyInactive(row) ? [cfg.field, "isActive"] : [cfg.field]),
      (row) => {
        const already = cfg.field === "status" ? (row.status ?? "ACTIVE") === value && !legacyInactive(row) : (row.isActive ?? true) === value;
        if (already) return a.active ? "already active" : "already inactive";
        // The list shows a crew member with a legacy `isActive:false` as inactive whatever their status, so
        // reactivating one clears that flag too (otherwise the row would read as inactive again).
        return a.active && legacyInactive(row) ? { [cfg.field]: value, isActive: true } : { [cfg.field]: value };
      },
      (row) => `${verb} ${nameOf(row)}`,
      (row) => skipReason(ctx, a.kind, a.orgId, row, to, todayMs),
    );
  },
});

/**
 * The exact Undo of any of the above, per record: `undoFieldEdit` (author, window, once,
 * compare-and-set). Never throws for one record that cannot be undone: that record is KEPT
 * and named with the reason; the rest are restored. Ids only.
 */
export const undoManyNative = mutation({
  returns: v.object({ restored: v.array(v.string()), kept: v.array(v.object({ id: v.string(), reason: v.string() })) }),
  args: { ...base, items: v.array(pair) },
  handler: async (ctx, a) => {
    const actor = await guards(ctx, a.kind, a.orgId, a.items.length, a);
    const cfg = CFG[a.kind];
    const restored: string[] = [];
    const kept: { id: string; reason: string }[] = [];
    for (const it of a.items) {
      const row = await loadRow(ctx, cfg, it.id, a.orgId);
      if (!row) { kept.push({ id: it.id, reason: "not found" }); continue; }
      try {
        await undoFieldEdit(ctx, {
          orgId: a.orgId, entityType: cfg.entityType, entityId: it.id, entityName: nameOf(row), auditId: it.auditId, actor, now: a.now,
          load: async () => loadRow(ctx, cfg, it.id, a.orgId),
          apply: async (doc, plan) => {
            const patch: Record<string, unknown> = { ...plan.set };
            for (const f of plan.clear) patch[f] = undefined;
            await patchRow(ctx, cfg, doc as Row, patch, a.now);
            await bumpCrew(ctx, a.kind, a.orgId, doc as Row, patch);
          },
        });
        restored.push(it.id);
      } catch (e) {
        const data = (e as { data?: { message?: string } }).data;
        kept.push({ id: it.id, reason: data?.message ?? (e as Error).message });
      }
    }
    return { restored, kept };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addTagManyNative: { danger: "medium" },
  setActiveManyNative: { danger: "high" },
  undoManyNative: { danger: "high" },
};
