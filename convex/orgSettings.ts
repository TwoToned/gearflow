import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Per-org BUSINESS settings — Convex-only source of truth (Phase 1 inversion).
 *
 * Replaces the `organization.metadata` JSON blob + `defaultTaxRate` +
 * `apiKillSwitchAt` columns on the Better Auth `organization` row, so the org
 * row keeps only auth-identity fields. RBAC/validation/audit stay in the
 * Next.js server actions (Phase 1), so every function here requires the trusted
 * backend SERVICE token — browser access is rejected. See FEATUREDOCS/54.
 *
 * The `settings` field is the JSON string of the OrgSettings TS shape. Counter
 * reservation is done INSIDE a mutation (serializable → atomic, no TOCTOU).
 */

/** Load the (at most one) row for an org, or null. */
async function loadByOrg(ctx: MutationCtx, organizationId: string): Promise<Doc<"orgSettings"> | null> {
  return await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
}

export const getByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("orgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .unique();
  },
});

// iCal feed lookup: `icalToken` is denormalised ONLY while the feed is enabled,
// so a hit here means "valid + live". Returns the row (caller reads its org id).
export const getByIcalToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireService(ctx);
    return await ctx.db
      .query("orgSettings")
      .withIndex("by_icalToken", (q) => q.eq("icalToken", token))
      .first();
  },
});

// Full-blob upsert (updateOrganization / ical toggles / SSO writes / login flag).
// The caller owns the blob shape; it passes the derived denorm values. `null`
// clears the optional field (undefined → db.patch removes it). Serializable, so
// concurrent first-time saves can't create two rows (loser retries + patches).
export const upsertSettings = mutation({
  args: {
    organizationId: v.string(),
    settings: v.string(),
    defaultTaxRate: v.optional(v.union(v.number(), v.null())),
    icalToken: v.optional(v.union(v.string(), v.null())),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, settings, defaultTaxRate, icalToken, now }) => {
    await requireService(ctx);
    const existing = await loadByOrg(ctx, organizationId);

    // Preserve the reservation counters. They're advanced ONLY by the reserve*
    // mutations; a full-blob save (settings form / SSO / ical) must never roll a
    // concurrently-reserved counter backwards, so carry forward max(stored, incoming).
    const mergedSettings = existing?.settings
      ? mergeCounters(existing.settings, settings)
      : settings;

    // undefined arg = leave field unchanged; null = clear (Convex removes an
    // optional field when patched to undefined); a value sets it.
    const existingPatch: Record<string, unknown> = { settings: mergedSettings, updatedAt: now };
    if (defaultTaxRate !== undefined) {
      existingPatch.defaultTaxRate = defaultTaxRate === null ? undefined : defaultTaxRate;
    }
    if (icalToken !== undefined) {
      existingPatch.icalToken = icalToken === null ? undefined : icalToken;
    }

    if (existing) {
      await ctx.db.patch(existing._id, existingPatch);
      return existing._id;
    }
    return await ctx.db.insert("orgSettings", {
      organizationId,
      settings: mergedSettings,
      defaultTaxRate: defaultTaxRate == null ? undefined : defaultTaxRate,
      icalToken: icalToken == null ? undefined : icalToken,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Atomic asset-tag reservation: read-modify-write the counter inside the blob.
// Creates the row (with defaults) if the org has never saved settings.
export const reserveAssetTags = mutation({
  args: { organizationId: v.string(), count: v.number(), now: v.number() },
  handler: async (ctx, { organizationId, count, now }) => {
    await requireService(ctx);
    // Shared RMW (keystone) — also called INSIDE browser-direct create mutations.
    return await reserveAssetTagCounter(ctx, organizationId, count, now);
  },
});

// Atomic sub-hire order-number reservation (SH-NNNN), same RMW pattern. Replaces
// the old `prisma.organization.metadata.subHireOrderCounter` counter so the org row
// stays auth-only. `floor` seeds the counter to at least this value on the first
// Convex reservation — used at cutover to carry forward the Postgres counter so
// numbers never regress into an already-issued range.
export const reserveSubHireOrderNumber = mutation({
  args: { organizationId: v.string(), now: v.number(), floor: v.optional(v.number()) },
  handler: async (ctx, { organizationId, now, floor }) => {
    await requireService(ctx);
    const existing = await loadByOrg(ctx, organizationId);
    const blob = existing?.settings ? safeParse(existing.settings) : {};
    const stored = (blob.subHireOrderCounter as number) || 0;
    const current = Math.max(stored, floor ?? 0);
    const next = current + 1;
    blob.subHireOrderCounter = next;
    const settings = JSON.stringify(blob);
    if (existing) {
      await ctx.db.patch(existing._id, { settings, updatedAt: now });
    } else {
      await ctx.db.insert("orgSettings", { organizationId, settings, createdAt: now, updatedAt: now });
    }
    return { orderNumber: `SH-${String(next).padStart(4, "0")}` };
  },
});

// Atomic test-tag-id reservation — same pattern, nested `testTag.counter`.
export const reserveTestTagIds = mutation({
  args: { organizationId: v.string(), count: v.number(), now: v.number() },
  handler: async (ctx, { organizationId, count, now }) => {
    await requireService(ctx);
    const existing = await loadByOrg(ctx, organizationId);
    const blob = existing?.settings ? safeParse(existing.settings) : {};
    const tt = (blob.testTag as Record<string, unknown>) || {};
    const prefix = (tt.prefix as string) || "TT";
    const digits = (tt.digits as number) || 4;
    const current = (tt.counter as number) || 0;
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      ids.push(`${prefix}${String(current + i).padStart(digits, "0")}`);
    }
    blob.testTag = { ...tt, counter: current + count };
    const settings = JSON.stringify(blob);
    if (existing) {
      await ctx.db.patch(existing._id, { settings, updatedAt: now });
    } else {
      await ctx.db.insert("orgSettings", { organizationId, settings, createdAt: now, updatedAt: now });
    }
    return { ids };
  },
});

// API kill-switch toggle (denormalised timestamp column).
export const setApiKillSwitch = mutation({
  args: { organizationId: v.string(), enabled: v.boolean(), now: v.number() },
  handler: async (ctx, { organizationId, enabled, now }) => {
    await requireService(ctx);
    const at = enabled ? now : undefined;
    const existing = await loadByOrg(ctx, organizationId);
    if (existing) {
      await ctx.db.patch(existing._id, { apiKillSwitchAt: at, updatedAt: now });
    } else {
      await ctx.db.insert("orgSettings", {
        organizationId,
        apiKillSwitchAt: at,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { apiKillSwitchAt: at ?? null };
  },
});

// Backfill: copy an org's legacy Postgres settings into Convex, idempotently.
export const createIfMissing = mutation({
  args: {
    organizationId: v.string(),
    settings: v.optional(v.string()),
    defaultTaxRate: v.optional(v.number()),
    apiKillSwitchAt: v.optional(v.number()),
    icalToken: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await loadByOrg(ctx, args.organizationId);
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("orgSettings", args);
    return { _id, created: true };
  },
});

// Corrupt/absent JSON → treat as empty settings (matches the legacy Postgres
// read path, which caught JSON.parse errors and continued with {}).
function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const maxCounter = (a: unknown, b: unknown) => Math.max(Number(a) || 0, Number(b) || 0);

// Carry the stored asset-tag + test-tag counters forward into an incoming blob so
// a full-blob save can't overwrite a value the reserve* mutations advanced.
function mergeCounters(storedJson: string, incomingJson: string): string {
  const stored = safeParse(storedJson);
  let incoming: Record<string, unknown>;
  try {
    const v = JSON.parse(incomingJson);
    if (!v || typeof v !== "object") return incomingJson;
    incoming = v as Record<string, unknown>;
  } catch {
    return incomingJson;
  }
  if (stored.assetTagCounter != null || incoming.assetTagCounter != null) {
    incoming.assetTagCounter = maxCounter(stored.assetTagCounter, incoming.assetTagCounter);
  }
  const storedTT = (stored.testTag as Record<string, unknown> | undefined)?.counter;
  const incomingTTObj = (incoming.testTag as Record<string, unknown> | undefined) ?? undefined;
  const incomingTT = incomingTTObj?.counter;
  if (storedTT != null || incomingTT != null) {
    incoming.testTag = { ...(incomingTTObj ?? {}), counter: maxCounter(storedTT, incomingTT) };
  }
  return JSON.stringify(incoming);
}
