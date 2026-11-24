import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor, requireOrgReadDocFor, requireService, redactFields } from "./lib/auth";
import { canSeeCrewPay } from "./lib/crewPayVisibility";
import { crewRoleUsage } from "./lib/crewRoleUsage";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for CrewRole (Convex table "crewRoles"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List crew roles for the org (rate fields only for callers who see crew pay: manager+ and not a noFinancials key).", danger: "low", mcpTier: 2 },
  listForSettings: { summary: "Crew roles for the roles sheet, rate fields only for callers who see crew pay.", danger: "low", mcpTier: 2 },
  usage: { summary: "Usage counts (crew/assignments/services) for a crew role, for the archive-with-usage-guard pre-check.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get a single crew role by id (rate fields only for callers who see crew pay).", danger: "low", mcpTier: 2 },
  ratesVisible: { summary: "Whether the caller may see crew pay (role cost/charge rates): manager+ and not a noFinancials key.", danger: "low", mcpTier: 3 },
};

/**
 * Does THIS caller see crew pay? The server's own answer (`canSeeCrewPay`), so
 * the roles sheet shows or hides the rate columns — and sends rates on an edit
 * — from what the server will actually return, never from the client's role
 * (`listForSettings` strips the rates as absent keys, which a manager's role
 * with no rates set looks identical to).
 */
export const ratesVisible = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<boolean> => {
    await requireOrgReadFor(ctx, orgId, "crew");
    return await canSeeCrewPay(ctx, orgId);
  },
});

/** A role's pay fields: the cost (`defaultRate`) and the charge (`chargeRate`). */
const ROLE_RATE_FIELDS =["defaultRate", "chargeRate"] as const;

/**
 * Field-level read boundary for every crew-role read: the rates are stripped
 * (absent keys) unless the ONE crew-pay rule says the caller sees pay
 * (`canSeeCrewPay`: manager+ AND not a `noFinancials` key; the service
 * identity always does, so server-side cost math keeps its inputs). Resolved
 * once per call, applied per row (UX Phase 15, review S1).
 */
async function roleRowRedactor(ctx: QueryCtx, orgId: string): Promise<<R extends Doc<"crewRoles">>(row: R) => R> {
  if (await canSeeCrewPay(ctx, orgId)) return (row) => row;
  return (row) => redactFields(row, ROLE_RATE_FIELDS);
}

async function orgRoles(ctx: QueryCtx, orgId: string): Promise<Doc<"crewRoles">[]> {
  const rows = await ctx.db
    .query("crewRoles")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org config set (crew roles) — see docs/exceptions.md R-8.3.3
    .collect();
  return rows.map(await roleRowRedactor(ctx, orgId));
}

/**
 * Every role in the org. Rates follow the crew-pay rule (`roleRowRedactor`):
 * a cost preview below the pay line gets no rate to preview with, which is the
 * point — pay is decided server-side, never by a client hiding a column.
 */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "crew"); // Phase 2 read bootstrap (#998)
    return await orgRoles(ctx, orgId);
  },
});

/**
 * Roles-admin list (WS10 #949, the Crew roles & rates sheet). The same rows and
 * the same redaction as `list` (both read `roleRowRedactor`); kept as its own
 * operation for the roles sheet and API callers that already name it.
 */
export const listForSettings = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "crew"); // Phase 2 read bootstrap (#998)
    return await orgRoles(ctx, orgId);
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
    await requireOrgReadFor(ctx, orgId, "crew"); // Phase 2 read bootstrap (#998)
    return await crewRoleUsage(ctx, id, orgId);
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "crew"); // Phase 2 read bootstrap (#998)
    if (!doc) return doc;
    return (await roleRowRedactor(ctx, doc.organizationId))(doc);
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
