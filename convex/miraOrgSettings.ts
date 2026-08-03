import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * MiraOrgSettings — one row per org (Mira LLM tool-calling, see the table doc
 * comment in convex/schema.ts). SERVICE-only: written exclusively by
 * src/server/mira-settings.ts after `requirePermission("orgSettings", "update")`,
 * read by src/server/mira.ts to decide which API-key preset Mira provisions and
 * which model/key to call. Never agent-reachable — an agent token configuring
 * its OWN escalation path (or reading another org's encrypted key) would be a
 * privilege-escalation / cross-tenant credential leak, the same class of risk
 * apiKeys.ts's own agentOps denials guard against.
 */

export const getForOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("miraOrgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    openRouterKeyEncrypted: v.optional(v.string()),
    model: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    writeAccessEnabled: v.boolean(),
    updatedAt: v.number(),
    updatedById: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dup = await ctx.db.query("miraOrgSettings").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dup) throw new ConvexError("miraOrgSettings id collision: " + args.id);
    const dupOrg = await ctx.db
      .query("miraOrgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (dupOrg) throw new ConvexError("miraOrgSettings already exists for org: " + args.organizationId);
    await ctx.db.insert("miraOrgSettings", args);
  },
});

/**
 * Patch an existing row. When `writeAccessEnabled` actually CHANGES (either
 * direction), every already-provisioned `miraKeys` row for the org — and its
 * underlying `apiKeys` row — is revoked and deleted. Mira lazily re-provisions
 * on the next question, picking the preset that matches the NEW setting
 * (src/server/mira.ts `getOrProvisionMiraToken`). Without this, a member who
 * already has a cached read_only_agent key would stay stuck read-only forever
 * after an admin turns write access on (or, worse, keep a full_agent key's
 * scopes cached after an admin turns it back off).
 */
type PatchArgs = {
  openRouterKeyEncrypted?: string;
  model?: string;
  baseUrl?: string;
  writeAccessEnabled?: boolean;
  updatedById?: string;
};

function buildSettingsPatch(args: PatchArgs): Record<string, unknown> {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.openRouterKeyEncrypted !== undefined) patch.openRouterKeyEncrypted = args.openRouterKeyEncrypted;
  if (args.model !== undefined) patch.model = args.model;
  // "" means "clear it, use the default (OpenRouter)" — never store an empty
  // string, an unset field is what src/server/mira.ts's getMiraLlmConfig
  // checks for.
  if (args.baseUrl !== undefined) patch.baseUrl = args.baseUrl || undefined;
  if (args.updatedById !== undefined) patch.updatedById = args.updatedById;
  if (args.writeAccessEnabled !== undefined) patch.writeAccessEnabled = args.writeAccessEnabled;
  return patch;
}

/** Revoke + delete every already-provisioned miraKeys row for the org, so the
 *  next question re-provisions with whichever preset now matches
 *  `writeAccessEnabled`. Bounded by org membership (one row per member), not
 *  an unbounded org-wide scan — a capped take, not a full-table read, so this
 *  stays outside the R-9.8 unbounded-read count (POLICY.md). */
async function revokeStaleMiraKeys(ctx: MutationCtx, organizationId: string): Promise<void> {
  const staleKeys = await ctx.db
    .query("miraKeys")
    .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", organizationId))
    .take(500);
  for (const mk of staleKeys) {
    const apiKeyDoc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", mk.apiKeyId)).unique();
    if (apiKeyDoc) await ctx.db.patch(apiKeyDoc._id, { isActive: false, revokedAt: Date.now() });
    await ctx.db.delete(mk._id);
  }
}

export const patch = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    openRouterKeyEncrypted: v.optional(v.string()),
    model: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    writeAccessEnabled: v.optional(v.boolean()),
    updatedById: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraOrgSettings").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (!doc || doc.organizationId !== args.organizationId) {
      throw new ConvexError("miraOrgSettings not found: " + args.id);
    }

    const writeAccessChanged = args.writeAccessEnabled !== undefined && args.writeAccessEnabled !== doc.writeAccessEnabled;
    await ctx.db.patch(doc._id, buildSettingsPatch(args));
    if (writeAccessChanged) await revokeStaleMiraKeys(ctx, args.organizationId);
  },
});

/** Clear the stored OpenRouter key (an explicit "disconnect", mirroring Xero's
 *  disconnect action) without touching model/writeAccessEnabled. */
export const disconnectOpenRouter = mutation({
  args: { id: v.string(), organizationId: v.string(), updatedById: v.optional(v.string()) },
  handler: async (ctx, { id, organizationId, updatedById }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraOrgSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== organizationId) throw new ConvexError("miraOrgSettings not found: " + id);
    await ctx.db.patch(doc._id, { openRouterKeyEncrypted: undefined, updatedAt: Date.now(), updatedById });
  },
});
