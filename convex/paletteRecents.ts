import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead } from "./lib/auth";
import { readableSearchTypes } from "./lib/searchResultResource";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { MAX_RECENT_ID_LENGTH, MAX_RECENT_REFS, type RecentRef, type RecentType } from "./lib/paletteRecentRefs";

/**
 * The ⌘K palette's Recent group (UX Phase 11, §6d.3, decision Q7). The browser
 * keeps the last five rows a person opened as `{ type, id }` refs ONLY, in
 * localStorage keyed per (org, user) — no names at rest, no Convex table. This
 * query turns those refs back into rows:
 *
 *   • each ref is read by `by_cuid` (a GLOBAL index) and dropped unless its
 *     `organizationId` is the requested org — a ref copied in from another org's
 *     storage, or forged, resolves to nothing;
 *   • a ref whose type the caller's role can't read is dropped, through the same
 *     resource table global search filters by (`lib/searchResultResource.ts`);
 *   • a ref to a deleted/archived record is dropped; the client forgets it.
 *
 * Titles and hrefs match `globalSearch.search`'s for the same record, so a row
 * reads the same in Recent as it did in the results it was opened from.
 */

export type RecentRow = {
  type: RecentType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  status?: string;
};


/** One org-checked `by_cuid` point read: the row only if it belongs to `orgId`. */
async function inOrg<D extends { organizationId?: string | null }>(
  read: Promise<D | null>,
  orgId: string,
): Promise<D | null> {
  const doc = await read;
  return doc && doc.organizationId === orgId ? doc : null;
}

const one = <T extends "projects" | "assets" | "kits" | "models" | "clients" | "crewMembers" | "suppliers" | "locations">(
  ctx: QueryCtx,
  table: T,
  id: string,
): Promise<Doc<T> | null> =>
  (ctx.db.query(table) as unknown as {
    withIndex: (n: "by_cuid", f: (q: { eq: (k: "id", v: string) => unknown }) => unknown) => { first: () => Promise<Doc<T> | null> };
  })
    .withIndex("by_cuid", (q) => q.eq("id", id))
    .first();

type Loader = (ctx: QueryCtx, orgId: string, id: string) => Promise<Omit<RecentRow, "type" | "id"> | null>;

const LOADERS: Record<RecentType, Loader> = {
  project: async (ctx, orgId, id) => {
    const p = await inOrg(one(ctx, "projects", id), orgId);
    if (!p || p.isTemplate) return null;
    return { title: `${p.projectNumber} — ${p.name}`, subtitle: p.status ?? null, href: `/projects/${p.id}`, status: p.status };
  },
  asset: async (ctx, orgId, id) => {
    const a = await inOrg(one(ctx, "assets", id), orgId);
    if (!a || a.isActive === false) return null;
    const model = a.modelId ? await inOrg(one(ctx, "models", a.modelId), orgId) : null;
    return { title: a.assetTag + (a.customName ? ` — ${a.customName}` : ""), subtitle: model?.name ?? null, href: `/assets/registry/${a.id}` };
  },
  kit: async (ctx, orgId, id) => {
    const k = await inOrg(one(ctx, "kits", id), orgId);
    if (!k || k.isActive === false) return null;
    return { title: `${k.assetTag} — ${k.name}`, subtitle: k.caseType || k.description || null, href: `/kits/${k.id}` };
  },
  model: async (ctx, orgId, id) => {
    const m = await inOrg(one(ctx, "models", id), orgId);
    if (!m || m.isActive === false) return null;
    return { title: m.name + (m.modelNumber ? ` (${m.modelNumber})` : ""), subtitle: m.manufacturer ?? null, href: `/assets/models/${m.id}` };
  },
  client: async (ctx, orgId, id) => {
    const c = await inOrg(one(ctx, "clients", id), orgId);
    if (!c || c.isActive === false) return null;
    return { title: c.name, subtitle: null, href: `/clients/${c.id}` };
  },
  crew: async (ctx, orgId, id) => {
    const c = await inOrg(one(ctx, "crewMembers", id), orgId);
    if (!c || c.status === "ARCHIVED") return null;
    return { title: `${c.firstName} ${c.lastName}`, subtitle: c.email ?? null, href: `/crew/${c.id}` };
  },
  supplier: async (ctx, orgId, id) => {
    const s = await inOrg(one(ctx, "suppliers", id), orgId);
    if (!s || s.isActive === false) return null;
    return { title: s.name, subtitle: s.contactName ?? null, href: `/suppliers/${s.id}` };
  },
  location: async (ctx, orgId, id) => {
    const l = await inOrg(one(ctx, "locations", id), orgId);
    if (!l) return null;
    return { title: l.name, subtitle: l.address ?? null, href: `/locations/${l.id}` };
  },
};

function assertRefs(refs: RecentRef[]): void {
  if (refs.length > MAX_RECENT_REFS) {
    throw new ConvexError(`At most ${MAX_RECENT_REFS} recent rows can be resolved at once.`);
  }
  if (refs.some((r) => r.id.length === 0 || r.id.length > MAX_RECENT_ID_LENGTH)) {
    throw new ConvexError("A recent row id is empty or too long.");
  }
}

export const resolve = query({
  args: {
    orgId: v.string(),
    refs: v.array(
      v.object({
        type: v.union(
          v.literal("project"), v.literal("asset"), v.literal("kit"), v.literal("model"),
          v.literal("client"), v.literal("crew"), v.literal("supplier"), v.literal("location"),
        ),
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, { orgId, refs }): Promise<RecentRow[]> => {
    await requireOrgRead(ctx, orgId);
    assertRefs(refs);
    if (refs.length === 0) return [];
    const readable = await readableSearchTypes(ctx, orgId);
    const rows = await Promise.all(
      refs.map(async (ref): Promise<RecentRow | null> => {
        if (!readable.has(ref.type)) return null;
        const row = await LOADERS[ref.type](ctx, orgId, ref.id);
        // Every loader's row passed `inOrg`: organizationId === orgId (by_cuid is global).
        return row ? { type: ref.type, id: ref.id, ...row } : null;
      }),
    );
    return rows.filter((r): r is RecentRow => r !== null);
  },
});

export const agentOps: AgentOpsAnnotations = {
  resolve: {
    agentAccess: "denied",
    reason: "Resolves the browser palette's own localStorage Recent refs across several RBAC domains (same per-result-type scope gap as globalSearch.search); no agent use.",
  },
};
