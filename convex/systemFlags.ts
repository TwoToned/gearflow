import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Platform-global SINGLETON flags — the browser-direct mutation kill-switch
 * (see convex/lib/writeGuard.ts). SERVICE-only: only the trusted backend / an
 * operator (via scripts/toggle-write-killswitch.ts) reads or flips it.
 */

export const getFlags = query({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    return await ctx.db.query("systemFlags").first();
  },
});

// Upsert the singleton: flip the write kill-switch (whole surface or specific
// domains). One serializable mutation, so concurrent first-time flips can't create
// two rows. Returns the resulting row.
export const setWrites = mutation({
  args: {
    disabled: v.boolean(),
    reason: v.optional(v.string()),
    domains: v.optional(v.array(v.string())),
    now: v.number(),
  },
  handler: async (ctx, { disabled, reason, domains, now }) => {
    await requireService(ctx);
    const existing = await ctx.db.query("systemFlags").first();
    const patch = {
      writesDisabled: disabled,
      disabledReason: reason,
      disabledDomains: domains,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return (await ctx.db.get(existing._id))!;
    }
    const _id = await ctx.db.insert("systemFlags", patch);
    return (await ctx.db.get(_id))!;
  },
});

export const agentOps: AgentOpsAnnotations = {
  getFlags: {
    agentAccess: "denied",
    reason: "This IS the platform-global browser-mutation write-kill-switch; an agent must never be able to inspect (let alone influence timing around) its own kill switch. Also platform-global, not org-scoped, so no Resource fits.",
  },
};
