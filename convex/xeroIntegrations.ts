import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgRead } from "./lib/auth";

/**
 * Thin CRUD for XeroIntegration (Convex table "xeroIntegrations"), one row per
 * org — modeled directly on convex/wooCommerceIntegrations.ts (WS1 #940).
 *
 * AUTH: this is a SERVICE-ONLY surface (FEATUREDOCS/54's "external
 * API/crypto" carve-out bucket — same bucket as woocommerce/webhooks). Every
 * write is called from `src/server/xero.ts` ("use server", holding the
 * service token), never directly from the browser, so there is no browser-
 * direct guard stack (assertWritesEnabled/enforceBrowserWriteLimit/
 * requireOrgPermission/resolveActor) here — the server action already ran
 * requirePermission("orgSettings", ...) before calling in.
 *
 * `getForOrg` IS on the browser-readable path (used by `useXeroLinked()` /
 * the Settings -> Xero page) — it deliberately exposes only the
 * connection/config shape, never `refreshTokenEncrypted` (see the `public`
 * projection below), so the encrypted secret never reaches the browser.
 */

const integrationFields = {
  organizationId: v.string(),
  isConnected: v.optional(v.boolean()),
  tenantId: v.optional(v.string()),
  tenantName: v.optional(v.string()),
  refreshTokenEncrypted: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
  connectedById: v.optional(v.string()),
  defaultAccountCode: v.optional(v.string()),
  serviceAccountDefaults: v.optional(v.any()),
  defaultTaxType: v.optional(v.string()),
  cachedAccounts: v.optional(v.any()),
  cachedTaxRates: v.optional(v.any()),
  cacheRefreshedAt: v.optional(v.number()),
  cacheError: v.optional(v.string()),
  lastSyncError: v.optional(v.string()),
};

export const getByOrgId = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db.query("xeroIntegrations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).unique();
  },
});

/** Browser-readable projection — used by `useXeroLinked()` and the Settings ->
 *  Xero page. Never includes `refreshTokenEncrypted`. */
export const getForOrg = query({
  args: { organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      isConnected: v.optional(v.boolean()),
      tenantName: v.optional(v.string()),
      connectedAt: v.optional(v.number()),
      defaultAccountCode: v.optional(v.string()),
      serviceAccountDefaults: v.optional(v.any()),
      defaultTaxType: v.optional(v.string()),
      cachedAccounts: v.optional(v.any()),
      cachedTaxRates: v.optional(v.any()),
      cacheRefreshedAt: v.optional(v.number()),
      cacheError: v.optional(v.string()),
      lastSyncError: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgRead(ctx, organizationId);
    const doc = await ctx.db
      .query("xeroIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .unique();
    if (!doc) return null;
    return {
      isConnected: doc.isConnected,
      tenantName: doc.tenantName,
      connectedAt: doc.connectedAt,
      defaultAccountCode: doc.defaultAccountCode,
      serviceAccountDefaults: doc.serviceAccountDefaults,
      defaultTaxType: doc.defaultTaxType,
      cachedAccounts: doc.cachedAccounts,
      cachedTaxRates: doc.cachedTaxRates,
      cacheRefreshedAt: doc.cacheRefreshedAt,
      cacheError: doc.cacheError,
      lastSyncError: doc.lastSyncError,
    };
  },
});

export const createIfMissing = mutation({
  args: { id: v.string(), ...integrationFields, createdAt: v.optional(v.number()), updatedAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("xeroIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (existing) return { _id: existing._id, id: existing.id, created: false };
    const _id = await ctx.db.insert("xeroIntegrations", args);
    return { _id, id: args.id, created: true };
  },
});

export const patchXeroIntegration = mutation({
  args: {
    id: v.string(),
    set: v.object({
      isConnected: v.optional(v.boolean()),
      tenantId: v.optional(v.string()),
      tenantName: v.optional(v.string()),
      refreshTokenEncrypted: v.optional(v.string()),
      connectedAt: v.optional(v.number()),
      connectedById: v.optional(v.string()),
      defaultAccountCode: v.optional(v.string()),
      serviceAccountDefaults: v.optional(v.any()),
      defaultTaxType: v.optional(v.string()),
      cachedAccounts: v.optional(v.any()),
      cachedTaxRates: v.optional(v.any()),
      cacheRefreshedAt: v.optional(v.number()),
      cacheError: v.optional(v.string()),
      lastSyncError: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("xeroIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("xeroIntegrations not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
