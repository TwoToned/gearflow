import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService, getAuthContext, redactFields } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewMember (Convex table "crewMembers"). GENERATED — Phase 2/5.
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
    const docs = await ctx.db
      .query("crewMembers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded by the org's crew roster (full roster read)
      .collect();
    const auth = await getAuthContext(ctx);
    return auth?.kind === "service" ? docs : docs.map((d) => redactFields(d, ["icalToken"]));
  },
});

/**
 * Paginated CREW list — browser-native replacement for CrewTable's
 * useCrewMembers/useCrewRoles whole-org live subscriptions + client-side
 * filter/sort/paginate (Finding #1, docs/designs/perf-convex-efficiency-2026-06.md).
 * crewRole (name/color) is resolved server-side. The linked platform user's
 * name/image (Better Auth, cross-domain — Convex can't join it) stays a
 * separate merge the caller applies AFTER this query, same as before; search
 * here only covers this table's own fields (firstName/lastName/email/phone/
 * department/tags) — NOT the linked user's display name, a narrow, disclosed
 * behavior change from the old client-side search (see ProjectTable's git
 * history for the equivalent tradeoff notes elsewhere in this rollout).
 * icalToken is redacted for non-service callers, matching `list`.
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    type: v.optional(v.string()),
    department: v.optional(v.string()),
    status: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    // Allowlisted, not a passthrough: sort runs on the RAW doc (below, before
    // redaction), so an unvalidated client-supplied sortBy could be used to sort by
    // icalToken (a bearer secret for the unauthenticated crew-calendar route) —
    // the token value is stripped from the response, but its relative ordering
    // across rows would still leak. Only the columns CrewTable actually exposes as
    // sortable are allowed; anything else falls back to the default.
    const SORTABLE_FIELDS = new Set(["lastName", "type", "department", "email", "status"]);
    const sortBy = a.sortBy && SORTABLE_FIELDS.has(a.sortBy) ? a.sortBy : "lastName";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [rows, roles] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: deliberate server-side filter/sort/paginate over the bounded roster (design: perf-convex-efficiency-2026-06.md)
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: small bounded per-org config set (crew roles)
    ]);
    const roleMap = new Map(roles.map((r) => [r.id, r]));

    const filtered = rows.filter((m) => {
      if (a.type && m.type !== a.type) return false;
      if (a.department && m.department !== a.department) return false;
      if (a.status && m.status !== a.status) return false;
      if (a.search && !matchesSearch([m.firstName, m.lastName, m.email, m.phone, m.department, ...(m.tags ?? [])], a.search)) return false;
      return true;
    });

    const sorted = [...filtered].sort((x, y) =>
      compareValues((x as unknown as Record<string, unknown>)[sortBy], (y as unknown as Record<string, unknown>)[sortBy], dir),
    );
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const auth = await getAuthContext(ctx);
    const items = pageRows.map((m) => {
      const role = m.crewRoleId ? roleMap.get(m.crewRoleId) ?? null : null;
      const redacted = auth?.kind === "service" ? m : redactFields(m, ["icalToken"]);
      return {
        ...redacted,
        crewRole: role ? { id: role.id, name: role.name, color: role.color } : null,
      };
    });

    return { items, total, page, pageSize, totalPages };
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    if (!doc) return doc;
    const auth = await getAuthContext(ctx);
    return auth?.kind === "service" ? doc : redactFields(doc, ["icalToken"]);
  },
});

/**
 * Lookup a crew member by their iCal feed token (the public-calendar bearer).
 * Service-only — the token IS the auth. Uses the `by_icalToken` index. The public
 * calendar feed URL is externally reachable, so the previous full-table
 * `.collect().find()` was a cross-org scan an attacker could trigger at will by
 * hitting the feed endpoint with junk tokens (a scrape-able DoS). `.first()` (not
 * `.unique()`) because `icalToken` is nullable and the index is non-unique — many
 * rows share the `null` key, so `.unique()` would throw.
 */
export const getByIcalToken = query({
  args: { icalToken: v.string() },
  handler: async (ctx, { icalToken }) => {
    await requireService(ctx);
    return await ctx.db
      .query("crewMembers")
      .withIndex("by_icalToken", (q) => q.eq("icalToken", icalToken))
      .first();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("crewMembers", args);
    await bumpCountersForTable(ctx, "crewMembers", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewMembers", args);
    await bumpCountersForTable(ctx, "crewMembers", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      image: v.optional(v.string()),
      userId: v.optional(v.string()),
      type: v.optional(enums.CrewMemberType),
      status: v.optional(enums.CrewMemberStatus),
      department: v.optional(v.string()),
      defaultDayRate: v.optional(v.number()),
      defaultHourlyRate: v.optional(v.number()),
      overtimeMultiplier: v.optional(v.number()),
      currency: v.optional(v.string()),
      address: v.optional(v.string()),
      addressLatitude: v.optional(v.number()),
      addressLongitude: v.optional(v.number()),
      emergencyContactName: v.optional(v.string()),
      emergencyContactPhone: v.optional(v.string()),
      dateOfBirth: v.optional(v.number()),
      abnOrGst: v.optional(v.string()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      icalEnabled: v.optional(v.boolean()),
      icalToken: v.optional(v.string()),
      crewRoleId: v.optional(v.string()),
      skillIds: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "crewMembers", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "crewMembers", doc, null);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// Patch with explicit field CLEARING. `set` applies non-null values; every name
// in `clear` is set to undefined → Convex removes the optional field (the
// generated `update` can't clear, because toConvexDoc drops nulls before the wire).
export const patchMember = mutation({
  args: {
    id: v.string(),
    set: v.any(),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
    const patch: Record<string, unknown> = { ...(set ?? {}) };
    delete patch.organizationId;
    delete patch.id;
    for (const f of clear ?? []) patch[f] = undefined;
    await ctx.db.patch(doc._id, patch);
    await bumpCountersForTable(ctx, "crewMembers", doc, { ...doc, ...patch });
    return doc._id;
  },
});
