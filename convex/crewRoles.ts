import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService, isCallerManagerPlus, redactFields } from "./lib/auth";
import { crewRoleUsage } from "./lib/crewRoleUsage";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewRole (Convex table "crewRoles"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("crewRoles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org config set (crew roles) — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

/**
 * Roles-admin list (WS10 #949, `/crew/settings`) — same rows as `list`, but with
 * the cost (`defaultRate`) and charge (`chargeRate`) columns stripped for anyone
 * below manager+ standing (R-9.3 server-is-the-authority: the roles admin table
 * hides both rate columns from non-managers, so the redaction must happen here,
 * not just in the client component). Deliberately a SEPARATE query from `list` —
 * `list` is also used by cost-preview call sites elsewhere in the app (the
 * per-service crew rate table) that still need `defaultRate` to compute a live
 * preview regardless of viewer role; narrowing THAT query would regress those
 * call sites, which are out of scope for this ticket.
 */
export const listForSettings = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("crewRoles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org config set (crew roles) — see docs/exceptions.md R-8.3.3
      .collect();
    const managerPlus = await isCallerManagerPlus(ctx, orgId);
    return managerPlus ? rows : rows.map((r) => redactFields(r, ["defaultRate", "chargeRate"]));
  },
});

/**
 * Usage counts for a role (WS10 #949) — the pre-check half of "archive-with-usage-
 * guard": the settings page calls this BEFORE confirming an archive so the user
 * sees "used by N crew / M assignments / P services" up front, not just after the
 * fact. Read-only; archiving itself is never blocked by these counts (non-
 * destructive — see `crewRolesWrites.ts` `archiveNative`).
 */
export const usage = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await crewRoleUsage(ctx, id, orgId);
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    department: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultRate: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewRoles", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    department: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultRate: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewRoles", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      department: v.optional(v.string()),
      color: v.optional(v.string()),
      defaultRate: v.optional(v.number()),
      rateType: v.optional(enums.CrewRateType),
      sortOrder: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewRoles not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewRoles not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
