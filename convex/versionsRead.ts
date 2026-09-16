import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import { listProjectVersions } from "./lib/projectVersionState";
import { pickPlanFields } from "./lib/versionPlanFields";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the BROWSER-facing
 * reads over the real `projectVersions` table (Phase 1-3's `versions.ts`
 * verb set has no read side of its own). Two reads, split by weight:
 *
 * - `listForProject` — the lightweight summary list the header pill and the
 *   Versions panel both subscribe to (number/label/live/contentState/date).
 *   One query, two consumers (R-3.1) — neither surface runs its own list
 *   read.
 * - `getVersion` — a single version's PLAN FIELDS (`convex/lib/
 *   versionPlanFields.ts`'s `PLAN_FIELDS`, the SAME list `versions.
 *   createNative`/`makeLiveNative` read/write), for the client-side
 *   "composed object" (design §5 D32): when viewing a non-live version, the
 *   project-detail hook overlays these onto the live `projects` doc so every
 *   existing component reading `project.rentalStartDate` etc. keeps working
 *   unmodified. Mirrors `versions.createNative`'s own `isSourceLive` branch —
 *   a LIVE version's plan lives on `projects` itself (Phase 1 schema
 *   comment), never on its own `projectVersions` row.
 *
 * Both gated `requireOrgReadFor(orgId, "project")` (CLAUDE.md's agent rule
 * 3) rather than the resource-less `requireOrgPermission` — a version list/
 * read is exactly the kind of ordinary project-scoped read an agent token
 * should be able to make.
 */

const VERSION_SUMMARY = v.object({
  id: v.string(),
  number: v.number(),
  label: v.optional(v.string()),
  isLive: v.boolean(),
  contentState: v.union(v.literal("ready"), v.literal("missing")),
  createdAt: v.number(),
  createdById: v.string(),
  basedOnVersionId: v.optional(v.string()),
});

export const listForProject = query({
  args: { organizationId: v.string(), projectId: v.string() },
  returns: v.array(VERSION_SUMMARY),
  handler: async (ctx, { organizationId, projectId }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return [];

    const versions = await listProjectVersions(ctx, organizationId, projectId);
    return versions
      .map((version) => ({
        id: version.id,
        number: version.number,
        label: version.label,
        isLive: version.id === project.liveVersionId,
        contentState: version.contentState,
        createdAt: version.createdAt,
        createdById: version.createdById,
        basedOnVersionId: version.basedOnVersionId,
      }))
      .sort((a, b) => b.number - a.number);
  },
});

export const getVersion = query({
  args: { organizationId: v.string(), projectId: v.string(), versionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      number: v.number(),
      label: v.optional(v.string()),
      isLive: v.boolean(),
      contentState: v.union(v.literal("ready"), v.literal("missing")),
      createdAt: v.number(),
      createdById: v.string(),
      // The versioned PLAN FIELDS bag (`PLAN_FIELDS`) — heterogeneous
      // (strings/numbers/undefined), same `v.any()` shape this codebase
      // already uses for a snapshot entry's `data` (projectLocksRead.ts's
      // `ENTRY_RETURNS`). The one enumeration of WHICH fields is
      // `convex/lib/versionPlanFields.ts`; this validator doesn't repeat it.
      planFields: v.any(),
    }),
  ),
  handler: async (ctx, { organizationId, projectId, versionId }) => {
    await requireOrgReadFor(ctx, organizationId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== organizationId) return null;

    const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
    if (!version || version.organizationId !== organizationId || version.projectId !== projectId) return null;

    const isLive = version.id === project.liveVersionId;
    const planFields = pickPlanFields(isLive ? project : version);

    return {
      id: version.id,
      number: version.number,
      label: version.label,
      isLive,
      contentState: version.contentState,
      createdAt: version.createdAt,
      createdById: version.createdById,
      planFields,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: {
    summary: "List a project's versions (number, label, live, content state) for the version switcher/panel.",
    danger: "low",
    mcpTier: 2,
  },
  getVersion: {
    summary: "Read one project version's plan-field snapshot, for viewing a non-live version's dates/pricing terms.",
    danger: "low",
    mcpTier: 3,
  },
};
