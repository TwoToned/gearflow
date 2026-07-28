import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * PendingSSOApproval — Convex-native domain (Phase-1 decommission; the Postgres
 * `pending_sso_approval` table is frozen). The SSO approval workflow: an IdP login
 * under REQUIRE_APPROVAL provisioning enqueues a PENDING row; an org admin
 * approves (→ creates a Better-Auth member) or rejects it.
 *
 * RBAC/validation/audit/member-creation stay in the Next.js server actions
 * (`src/server/sso.ts`, `src/lib/sso-provisioning.ts`); these are the trusted-backend
 * SERVICE data layer. The old Prisma `@@unique([organizationId, userId])` is
 * reproduced by `createForProvisioning`, which is idempotent on (org, userId) inside
 * a single Convex mutation (transactional → no TOCTOU double-insert).
 */

/** Pending approvals for an org (the admin review queue), newest first. */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("pendingSSOApprovals")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "PENDING"))
      .order("desc")
      .collect();
  },
});

/** Existing approval for (org, user), any status — the provisioning dedup check. */
export const getByOrgUser = query({
  args: { orgId: v.string(), userId: v.string() },
  handler: async (ctx, { orgId, userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("pendingSSOApprovals")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", orgId).eq("userId", userId))
      .unique();
  },
});

/**
 * Enqueue a PENDING approval on SSO login. Idempotent on (org, userId) — mirrors the
 * old `@@unique` + "create only if none exists" (regardless of the existing row's
 * status). Returns the existing or newly-created row's id.
 */
export const createForProvisioning = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    idpGroups: v.optional(v.array(v.string())),
    suggestedRole: v.optional(v.string()),
    providerId: v.string(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("pendingSSOApprovals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    if (existing) return { id: existing.id, created: false };
    await ctx.db.insert("pendingSSOApprovals", { ...args, status: "PENDING" });
    return { id: args.id, created: true };
  },
});

/**
 * Approve/reject: org-guarded, only transitions a currently-PENDING row — this is the
 * atomic MUTUAL-EXCLUSION gate. A concurrent reject or a double-approve loses here
 * (throws "not found"), so the caller creates the Better-Auth member AT MOST ONCE and
 * NEVER after a rejection. Returns the approval's identity fields (userId/email/
 * suggestedRole) so the server action needs no second read.
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
    const doc = await ctx.db.query("pendingSSOApprovals").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId || doc.status !== "PENDING") {
      throw new ConvexError("Pending approval not found");
    }
    await ctx.db.patch(doc._id, { status, reviewedById, reviewedAt, ...(reviewNote ? { reviewNote } : {}) });
    return { userId: doc.userId, email: doc.email, suggestedRole: doc.suggestedRole ?? null };
  },
});

/**
 * Roll a just-APPROVED approval back to PENDING when the downstream member.create
 * failed — so an approve never leaves the user "approved but with no membership".
 * Org-guarded; only reverts an APPROVED row (never undoes a REJECTED decision).
 */
export const revertToPending = mutation({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("pendingSSOApprovals").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId || doc.status !== "APPROVED") return;
    await ctx.db.patch(doc._id, {
      status: "PENDING",
      reviewedById: undefined,
      reviewedAt: undefined,
      reviewNote: undefined,
    });
  },
});

const pendingSSOApprovalsDenyReason =
  "Site-admin SSO approval queue; platform-operator surface, not an org-scoped agent concern.";

export const agentOps: AgentOpsAnnotations = {
  list: { agentAccess: "denied", reason: pendingSSOApprovalsDenyReason },
  getByOrgUser: { agentAccess: "denied", reason: pendingSSOApprovalsDenyReason },
};
