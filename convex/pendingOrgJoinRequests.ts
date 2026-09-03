import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { isPersonalEmailDomain, emailDomain } from "./lib/personalEmailDomains";
import type { QueryCtx } from "./_generated/server";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * PendingOrgJoinRequest — B2 (#1094), the "join an existing org" half of
 * Phase B. A user with zero orgs and a verified email whose domain matches an
 * existing member's can ask to join (gated on the org's `joinPolicy` being
 * DOMAIN_REQUEST, `src/lib/org-join-policy.ts`). An org admin then
 * approves (→ creates a Better-Auth member, same as SSO approval) or rejects.
 *
 * SERVICE-only (like `pendingSSOApprovals.ts`) — RBAC/validation/audit/member
 * creation stay in the Next.js server actions (`src/server/org-join.ts`);
 * these are the trusted-backend data layer. Every authority check that
 * decides WHETHER a request may be created (policy, membership, domain match)
 * lives inside the `request` mutation itself, not the caller — R-9.3, and it
 * closes the TOCTOU window a two-step check-then-create would leave open.
 */

/** Pending requests for an org (the admin review queue), newest first. */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("pendingOrgJoinRequests")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "PENDING"))
      .order("desc")
      .collect();
  },
});

/** Every PENDING request a user has open, across all orgs — drives the
 *  "request sent" state on `/welcome` so a reload doesn't offer a duplicate
 *  "ask to join" button. */
export const listPendingByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("pendingOrgJoinRequests")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "PENDING"))
      .collect();
  },
});

async function orgMemberDomains(ctx: QueryCtx, organizationId: string): Promise<Set<string>> {
  const members = await ctx.db
    .query("members")
    // r9.8-ok: roster-scale, bounded by org headcount — see docs/exceptions.md (R-8.3.3, pendingOrgJoinRequests.ts)
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .collect();
  const domains = new Set<string>();
  for (const m of members) {
    const user = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", m.userId)).unique();
    const d = user?.email ? emailDomain(user.email) : undefined;
    if (d) domains.add(d);
  }
  return domains;
}

/**
 * Orgs whose `joinPolicy` is DOMAIN_REQUEST and that have at least one
 * existing member sharing the caller's email domain, excluding orgs the
 * caller is already a member of. Bounded by (# orgs with the policy enabled)
 * × (their member count) — expected small since it's opt-in per org, not a
 * scan of every org's members. Revisit with a dedicated domain index
 * (`orgJoinableDomains`-style) if that assumption stops holding.
 */
export const findJoinableOrgsForDomain = query({
  args: { domain: v.string(), excludeUserId: v.string() },
  handler: async (ctx, { domain, excludeUserId }) => {
    await requireService(ctx);
    const normalizedDomain = domain.toLowerCase();
    if (isPersonalEmailDomain(normalizedDomain)) return [];

    const allSettings = await ctx.db.query("orgSettings").collect(); // r9.8-ok: per-org opt-in scan, bounded by total org count — see docs/exceptions.md (R-8.3.3, pendingOrgJoinRequests.ts)
    const domainPolicyOrgIds: string[] = [];
    for (const row of allSettings) {
      if (!row.settings) continue;
      try {
        const parsed = JSON.parse(row.settings) as { joinPolicy?: string };
        if (parsed.joinPolicy === "DOMAIN_REQUEST") domainPolicyOrgIds.push(row.organizationId);
      } catch {
        // Malformed blob — skip, never crash the search over one bad row.
      }
    }

    const results: { organizationId: string; organizationName: string; memberCount: number }[] = [];
    for (const organizationId of domainPolicyOrgIds) {
      const existingMembership = await ctx.db
        .query("members")
        .withIndex("by_org_user", (q) => q.eq("organizationId", organizationId).eq("userId", excludeUserId))
        .first();
      if (existingMembership) continue;

      const members = await ctx.db
        .query("members")
        // r9.8-ok: roster-scale, bounded by org headcount — see docs/exceptions.md (R-8.3.3, pendingOrgJoinRequests.ts)
        .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
        .collect();
      let memberCount = 0;
      for (const m of members) {
        const user = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", m.userId)).unique();
        if (user?.email && emailDomain(user.email) === normalizedDomain) memberCount++;
      }
      if (memberCount === 0) continue;

      const org = await ctx.db.query("organizations").withIndex("by_cuid", (q) => q.eq("id", organizationId)).unique();
      if (!org) continue;
      results.push({ organizationId, organizationName: org.name, memberCount });
    }
    return results;
  },
});

/**
 * Create (or idempotently return) a PENDING join request. Re-derives and
 * re-checks every authority condition itself rather than trusting the caller
 * (R-9.3): the org's `joinPolicy` must be DOMAIN_REQUEST, the requester must
 * not already be a member, and at least one existing member must share the
 * requester's email domain (the same test `findJoinableOrgsForDomain` used to
 * surface this org in the first place — re-verified here so a stale client
 * read or a direct call can't create a request the search would never have
 * offered).
 */
export const request = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);

    const domain = emailDomain(args.email);
    if (!domain || isPersonalEmailDomain(domain)) {
      throw new ConvexError("This email domain can't be used to request to join an organisation.");
    }

    const settingsRow = await ctx.db
      .query("orgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const joinPolicy = settingsRow?.settings ? (JSON.parse(settingsRow.settings) as { joinPolicy?: string }).joinPolicy : undefined;
    if (joinPolicy !== "DOMAIN_REQUEST") {
      throw new ConvexError("This organisation isn't accepting join requests.");
    }

    const existingMembership = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) => q.eq("organizationId", args.organizationId).eq("userId", args.userId))
      .first();
    if (existingMembership) {
      throw new ConvexError("You're already a member of this organisation.");
    }

    const memberDomains = await orgMemberDomains(ctx, args.organizationId);
    if (!memberDomains.has(domain)) {
      throw new ConvexError("No existing member of this organisation shares your email domain.");
    }

    const existing = await ctx.db
      .query("pendingOrgJoinRequests")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", args.organizationId).eq("userId", args.userId))
      .unique();
    if (existing) {
      if (existing.status === "PENDING") return { id: existing.id, created: false };
      // A previously REJECTED/APPROVED request doesn't block a fresh ask —
      // APPROVED shouldn't recur (existingMembership above would have caught
      // it), but a REJECTED one is a legitimate "circumstances changed" retry.
      await ctx.db.patch(existing._id, {
        status: "PENDING",
        reviewedById: undefined,
        reviewedAt: undefined,
        reviewNote: undefined,
        createdAt: args.createdAt,
      });
      return { id: existing.id, created: true };
    }

    await ctx.db.insert("pendingOrgJoinRequests", {
      id: args.id,
      organizationId: args.organizationId,
      userId: args.userId,
      email: args.email,
      name: args.name,
      status: "PENDING",
      createdAt: args.createdAt,
    });
    return { id: args.id, created: true };
  },
});

/**
 * Approve/reject: org-guarded, only transitions a currently-PENDING row — the
 * same atomic mutual-exclusion gate as `pendingSSOApprovals.review`. A
 * concurrent reject or double-approve loses here (throws), so the caller
 * creates the member AT MOST ONCE and NEVER after a rejection.
 */
export const review = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    status: v.union(v.literal("APPROVED"), v.literal("REJECTED")),
    reviewedById: v.string(),
    reviewedAt: v.number(),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, { id, orgId, status, reviewedById, reviewedAt, reviewNote }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("pendingOrgJoinRequests").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId || doc.status !== "PENDING") {
      throw new ConvexError("Pending join request not found");
    }
    await ctx.db.patch(doc._id, { status, reviewedById, reviewedAt, ...(reviewNote ? { reviewNote } : {}) });
    return { userId: doc.userId, email: doc.email };
  },
});

/** Roll a just-APPROVED request back to PENDING when the downstream
 *  member.create failed — mirrors `pendingSSOApprovals.revertToPending`. */
export const revertToPending = mutation({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("pendingOrgJoinRequests").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId || doc.status !== "APPROVED") return;
    await ctx.db.patch(doc._id, {
      status: "PENDING",
      reviewedById: undefined,
      reviewedAt: undefined,
      reviewNote: undefined,
    });
  },
});

const denyReason =
  "Trusted-backend join-request queue/search; no org-scoped agent concern is defined for it yet.";

export const agentOps: AgentOpsAnnotations = {
  list: { agentAccess: "denied", reason: denyReason },
  listPendingByUser: { agentAccess: "denied", reason: denyReason },
  findJoinableOrgsForDomain: { agentAccess: "denied", reason: denyReason },
};
