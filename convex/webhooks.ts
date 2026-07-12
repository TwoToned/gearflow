import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Webhook + WebhookDelivery — Convex-native domain (Phase-1 decommission; the Postgres
 * `webhook` / `webhook_delivery` tables are frozen). This module is ONLY the data
 * layer: the delivery worker (HTTP send, HMAC signing, SSRF guard, cron) stays in
 * Next.js server code (`src/lib/webhooks/*`, `src/server/webhooks.ts`), calling these
 * with the trusted-backend SERVICE token. See docs/designs/webhooks.md.
 *
 * The queue's atomic claim (`claimDelivery`) is a transactional Convex mutation —
 * cleaner than the old Postgres `updateMany` optimistic lock and race-free by
 * construction (Convex mutations are serializable).
 */

// ── Webhook config ───────────────────────────────────────────────────────────

/** This org's endpoints (server strips the secret via READ_SHAPE). */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("webhooks")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .collect();
  },
});

/** Active endpoints subscribed to events — the emit() subscription read. */
export const activeSubscriptions = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("webhooks")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    return rows
      .filter((w) => w.isActive === true)
      .map((w) => ({ id: w.id, events: w.events ?? "[]" }));
  },
});

const webhookWriteArgs = {
  id: v.string(),
  organizationId: v.string(),
  description: v.string(),
  url: v.string(),
  events: v.optional(v.string()),
  secret: v.string(),
  isActive: v.optional(v.boolean()),
  consecutiveFailures: v.optional(v.number()),
  createdById: v.string(),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  previousSecret: v.optional(v.string()),
  previousSecretExpiresAt: v.optional(v.number()),
  disabledAt: v.optional(v.number()),
  lastDeliveryAt: v.optional(v.number()),
};

export const create = mutation({
  args: webhookWriteArgs,
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("webhooks", args);
  },
});

export const createIfMissing = mutation({
  args: webhookWriteArgs,
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("webhooks").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("webhooks", args);
    return { _id, created: true };
  },
});

/** Org-guarded webhook fetch — returns null if missing/other-org. */
async function ownedWebhook(ctx: MutationCtx, id: string, orgId: string) {
  const doc = await ctx.db.query("webhooks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  if (!doc || doc.organizationId !== orgId) return null;
  return doc;
}

export const update = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    patch: v.object({
      description: v.optional(v.string()),
      events: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      disabledAt: v.optional(v.union(v.number(), v.null())),
      consecutiveFailures: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, orgId, patch }) => {
    await requireService(ctx);
    const doc = await ownedWebhook(ctx, id, orgId);
    if (!doc) throw new ConvexError("Webhook endpoint not found");
    // Map an explicit null (clear disabledAt) to undefined (Convex removes the field).
    const applied: Record<string, unknown> = { ...patch };
    if (patch.disabledAt === null) applied.disabledAt = undefined;
    await ctx.db.patch(doc._id, applied);
    return await ctx.db.get(doc._id); // fresh doc for the server response + audit
  },
});

export const rotateSecret = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    secret: v.string(),
    previousSecretExpiresAt: v.number(),
  },
  handler: async (ctx, { id, orgId, secret, previousSecretExpiresAt }) => {
    await requireService(ctx);
    const doc = await ownedWebhook(ctx, id, orgId);
    if (!doc) throw new ConvexError("Webhook endpoint not found");
    // previousSecret is the CURRENT secret — read internally so the server never has to
    // round-trip the live secret out of the backend.
    await ctx.db.patch(doc._id, { secret, previousSecret: doc.secret, previousSecretExpiresAt });
    return { id: doc.id, description: doc.description };
  },
});

/** Delete an endpoint AND its deliveries (the old FK cascade, re-implemented). */
export const remove = mutation({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireService(ctx);
    const doc = await ownedWebhook(ctx, id, orgId);
    if (!doc) throw new ConvexError("Webhook endpoint not found");
    // Bounded delete: cap the delivery-log cascade so a huge history can't blow the
    // Convex per-mutation write limit and fail the endpoint deletion (the Postgres FK
    // cascade had no such cap). Any remainder becomes an orphan that dueDeliveries +
    // the worker fail out of the queue; SUCCEEDED/FAILED rows just age out. 4000 « 16k.
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", id))
      .take(4000);
    for (const d of deliveries) await ctx.db.delete(d._id);
    await ctx.db.delete(doc._id);
    return { id: doc.id, description: doc.description };
  },
});

// ── Delivery queue ───────────────────────────────────────────────────────────

/** Recent deliveries for one endpoint (self-serve debugging), newest first. */
export const deliveries = query({
  args: { orgId: v.string(), webhookId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, webhookId, limit }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .order("desc")
      .collect();
    return rows
      .filter((d) => d.organizationId === orgId)
      .slice(0, Math.min(limit ?? 50, 200));
  },
});

/** Enqueue N deliveries (one per matching endpoint) — the emit() write. */
export const enqueueDeliveries = mutation({
  args: {
    deliveries: v.array(
      v.object({
        id: v.string(),
        organizationId: v.string(),
        webhookId: v.string(),
        event: v.string(),
        payload: v.string(),
        createdAt: v.number(),
        nextAttemptAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { deliveries }) => {
    await requireService(ctx);
    for (const d of deliveries) {
      await ctx.db.insert("webhookDeliveries", { ...d, status: "PENDING", attempts: 0 });
    }
    return { enqueued: deliveries.length };
  },
});

/**
 * Global claim query for the worker: PENDING deliveries whose backoff has elapsed,
 * each joined to its webhook. Service-only (the cron worker is system-wide).
 */
export const dueDeliveries = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    await requireService(ctx);
    const due = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "PENDING").lte("nextAttemptAt", now))
      .order("asc")
      .take(limit ?? 50);
    const out = [];
    for (const d of due) {
      const base = {
        id: d.id,
        organizationId: d.organizationId,
        event: d.event,
        payload: d.payload,
        attempts: d.attempts ?? 0,
        nextAttemptAt: d.nextAttemptAt ?? 0,
        createdAt: d.createdAt ?? 0,
      };
      const webhook = await ctx.db.query("webhooks").withIndex("by_cuid", (q) => q.eq("id", d.webhookId)).unique();
      // Orphan (webhook deleted after this row was enqueued, past remove()'s cascade):
      // return it with webhook=null so the worker can FAIL it out of the PENDING queue.
      // If we skipped it, an always-"due" orphan would starve the batch limit forever.
      if (!webhook) {
        out.push({ ...base, webhook: null });
        continue;
      }
      out.push({
        ...base,
        webhook: {
          id: webhook.id,
          url: webhook.url,
          secret: webhook.secret,
          previousSecret: webhook.previousSecret ?? null,
          previousSecretExpiresAt: webhook.previousSecretExpiresAt ?? null,
          isActive: webhook.isActive === true,
        },
      });
    }
    return out;
  },
});

/**
 * Atomically CLAIM a due delivery (transactional — replaces the Postgres `updateMany`
 * optimistic lock). Only claims a still-PENDING, still-due row; bumps attempts and
 * pushes nextAttemptAt out by the lease so a concurrent worker's due-filter misses it.
 */
export const claimDelivery = mutation({
  args: { id: v.string(), now: v.number(), leaseMs: v.number() },
  handler: async (ctx, { id, now, leaseMs }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("webhookDeliveries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.status !== "PENDING" || (doc.nextAttemptAt ?? 0) > now) {
      return { claimed: false, attempts: doc?.attempts ?? 0 };
    }
    // Lease from CLAIM time (server Date.now()), not the batch's `now` — a sequential
    // batch's later claims must still get a full lease. `attempts` doubles as the
    // fencing token: the completion mutations only write if it's unchanged.
    const attempts = (doc.attempts ?? 0) + 1;
    await ctx.db.patch(doc._id, { attempts, nextAttemptAt: Date.now() + leaseMs });
    return { claimed: true, attempts };
  },
});

/**
 * A delivery whose endpoint was disabled/deleted after enqueue — mark FAILED, don't
 * send. FENCED (expectedAttempts + still-PENDING): if another worker already claimed
 * this row (attempts bumped) or completed it, this is a no-op — never clobber it.
 */
export const markEndpointDisabled = mutation({
  args: { deliveryId: v.string(), lastError: v.string(), expectedAttempts: v.number() },
  handler: async (ctx, { deliveryId, lastError, expectedAttempts }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("webhookDeliveries").withIndex("by_cuid", (q) => q.eq("id", deliveryId)).unique();
    if (!doc || doc.status !== "PENDING" || (doc.attempts ?? 0) !== expectedAttempts) return;
    await ctx.db.patch(doc._id, { status: "FAILED", lastError });
  },
});

/**
 * Successful delivery: mark SUCCEEDED + reset the endpoint's failure counter.
 * FENCED by `expectedAttempts`: a stale worker whose lease expired (and whose row was
 * re-claimed → attempts bumped) is a no-op, so it can't overwrite the newer attempt.
 */
export const markSucceeded = mutation({
  args: { deliveryId: v.string(), webhookId: v.string(), responseStatus: v.number(), deliveredAt: v.number(), expectedAttempts: v.number() },
  handler: async (ctx, { deliveryId, webhookId, responseStatus, deliveredAt, expectedAttempts }) => {
    await requireService(ctx);
    const d = await ctx.db.query("webhookDeliveries").withIndex("by_cuid", (q) => q.eq("id", deliveryId)).unique();
    if (!d || d.attempts !== expectedAttempts) return; // stale worker — a newer claim owns this row
    await ctx.db.patch(d._id, { status: "SUCCEEDED", responseStatus, deliveredAt, lastError: undefined });
    const w = await ctx.db.query("webhooks").withIndex("by_cuid", (q) => q.eq("id", webhookId)).unique();
    if (w) await ctx.db.patch(w._id, { consecutiveFailures: 0, lastDeliveryAt: deliveredAt });
  },
});

/**
 * Failed attempt: record the outcome + backoff on the delivery, bump the endpoint's
 * consecutiveFailures, and auto-disable it on HTTP 410 or once it crosses the
 * threshold. Encapsulates deliver.ts's failure branch atomically.
 */
export const markFailed = mutation({
  args: {
    deliveryId: v.string(),
    webhookId: v.string(),
    deliveryStatus: v.string(), // "PENDING" | "FAILED"
    responseStatus: v.optional(v.number()),
    lastError: v.string(),
    nextAttemptAt: v.number(),
    now: v.number(),
    gone: v.boolean(),
    autoDisableAfter: v.number(),
    expectedAttempts: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const d = await ctx.db.query("webhookDeliveries").withIndex("by_cuid", (q) => q.eq("id", args.deliveryId)).unique();
    // FENCED: a stale worker (lease expired, row re-claimed) is a no-op — it must not
    // flip a newer attempt's outcome or double-count the endpoint's failures.
    if (!d || d.attempts !== args.expectedAttempts) return;
    await ctx.db.patch(d._id, {
      status: args.deliveryStatus,
      responseStatus: args.responseStatus,
      lastError: args.lastError,
      nextAttemptAt: args.nextAttemptAt,
    });
    const w = await ctx.db.query("webhooks").withIndex("by_cuid", (q) => q.eq("id", args.webhookId)).unique();
    if (w) {
      const consecutiveFailures = (w.consecutiveFailures ?? 0) + 1;
      const disable = args.gone || consecutiveFailures >= args.autoDisableAfter;
      await ctx.db.patch(w._id, {
        consecutiveFailures,
        lastDeliveryAt: args.now,
        ...(disable ? { isActive: false, disabledAt: args.now } : {}),
      });
    }
  },
});
