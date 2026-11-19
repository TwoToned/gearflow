import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { getProjectWindow } from "./lib/projectWindow";
import { versionRows } from "./lib/versionScope";
import { lineUnitCounts, returnedLate } from "./lib/warehouseStage";

export const agentOps: AgentOpsAnnotations = {
  returning: {
    summary:
      "Returning mode board: every job with gear out or coming back, grouped by job, with per-line out / back / damaged / missing / late-back unit counts.",
    danger: "low",
    mcpTier: 2,
  },
  lineUnits: {
    summary: "Every unit of one line with its status, return condition, returned time and whether it came back late.",
    danger: "low",
    mcpTier: 3,
  },
};

/**
 * The floor's Returning mode (spec §9c.4, D26) — a LIVE subscription held only
 * while `?mode=returning`, replacing the returns station's one-shot board
 * (`warehouseReturns.bundle`, which goes when that page becomes a redirect).
 *
 * ── Bounded (POLICY.md R-9.8, no exception) ──
 * Every read is capped, and any cap that bites sets `truncated` so the UI says
 * "showing the first n" instead of silently dropping the tail:
 *   (a) CHECKED_OUT lines org-wide, `by_organizationId_status`, `.take(MAX_OUT_LINES)`
 *       — only to DISCOVER jobs with gear out, including COMPLETED/INVOICED
 *       jobs a project-status read would miss;
 *   (b) RETURNED jobs, `.take(MAX_RETURNED_JOBS)`;
 *   (c) at most MAX_JOBS jobs, each by `by_cuid`, org-checked, no templates;
 *   (d) each job's LIVE-version lines (one project's plan);
 *   (e) models / kits by `by_cuid`, org-checked;
 *   (f) units, only for lines with something back on jobs with an end date (the
 *       only units that can be LATE-back, D29), at most MAX_UNIT_LINES lines ×
 *       MAX_UNITS_PER_LINE units.
 * Late-still-out needs a clock, so the client derives it from `windowEnd`
 * (`convex/lib/warehouseStage.ts` `isLate`); only late-BACK is counted here.
 *
 * ── Rows ──
 * Top-level lines (`isKitChild` false) that have been out (out + back > 0).
 * ACCESSORY children nest under their parent and cascade with it (§9.5). Kit
 * members roll up under the kit parent (a kit returns whole). Sub-hire and
 * custom lines are listed but not scannable.
 */

const MAX_OUT_LINES = 2000;
const MAX_RETURNED_JOBS = 100;
const MAX_JOBS = 150;
const MAX_UNIT_LINES = 300;
const MAX_UNITS_PER_LINE = 500;

type Line = Doc<"projectLineItems">;
type LineKind = "serialized" | "bulk" | "kit" | "subhire" | "custom" | "generic";

function classifyLine(line: Line): LineKind {
  if (line.kitId) return "kit";
  if (line.subHireId) return "subhire";
  if (line.isCustomItem) return "custom";
  if (line.bulkAssetId) return "bulk";
  if (line.assetId) return "serialized";
  return "generic";
}

/** `by_cuid` is GLOBAL: keep only rows in the caller's org (R-8.4.3). */
async function loadOwn<T extends "projects" | "models" | "kits" | "assets">(
  ctx: QueryCtx,
  table: T,
  ids: readonly string[],
  orgId: string,
): Promise<Map<string, Doc<T>>> {
  const rows = await Promise.all(
    ids.map((id) => ctx.db.query(table as "projects").withIndex("by_cuid", (q) => q.eq("id", id)).first()),
  );
  const map = new Map<string, Doc<T>>();
  for (const r of rows) {
    if (r && r.organizationId === orgId) map.set(r.id, r as unknown as Doc<T>);
  }
  return map;
}

/** (a)–(c): the jobs to show, and whether any discovery cap bit. */
async function discoverJobs(ctx: QueryCtx, orgId: string) {
  const [outLines, returnedJobs] = await Promise.all([
    ctx.db
      .query("projectLineItems")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "CHECKED_OUT"))
      .take(MAX_OUT_LINES),
    ctx.db
      .query("projects")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "RETURNED"))
      .take(MAX_RETURNED_JOBS),
  ]);
  const ids = [...new Set([...outLines.map((l) => l.projectId), ...returnedJobs.map((p) => p.id)])];
  const truncated =
    outLines.length >= MAX_OUT_LINES || returnedJobs.length >= MAX_RETURNED_JOBS || ids.length > MAX_JOBS;
  const projects = await loadOwn(ctx, "projects", ids.slice(0, MAX_JOBS), orgId);
  const jobs = [...projects.values()].filter((p) => !p.isTemplate && p.liveVersionId);
  return { jobs, truncated };
}

/** (f): late-back units per line, for the lines that can have any. */
async function lateBackByLine(ctx: QueryCtx, orgId: string, lines: Line[], windowEndOf: (l: Line) => number | null) {
  const eligible = lines.filter((l) => lineUnitCounts(l).back > 0 && windowEndOf(l) != null);
  const read = eligible.slice(0, MAX_UNIT_LINES);
  let truncated = eligible.length > MAX_UNIT_LINES;
  const late = new Map<string, number>();
  await Promise.all(
    read.map(async (l) => {
      const units = await ctx.db
        .query("projectLineItemUnits")
        .withIndex("by_lineItemId", (q) => q.eq("lineItemId", l.id))
        .take(MAX_UNITS_PER_LINE);
      if (units.length >= MAX_UNITS_PER_LINE) truncated = true;
      const end = windowEndOf(l);
      const n = units
        .filter((u) => u.organizationId === orgId && returnedLate(u, end))
        .reduce((s, u) => s + (u.quantity ?? 1), 0);
      if (n > 0) late.set(l.id, n);
    }),
  );
  return { late, truncated };
}

type JobLines = { job: Doc<"projects">; lines: Line[] };

function accessoriesByParent(lines: Line[]) {
  const map = new Map<string, Line[]>();
  for (const c of lines) {
    if (!c.isKitChild || c.childKind !== "ACCESSORY" || !c.parentLineItemId) continue;
    map.set(c.parentLineItemId, [...(map.get(c.parentLineItemId) ?? []), c]);
  }
  return map;
}

function isListed(line: Line): boolean {
  if (line.isKitChild || line.isContainerLineItem) return false;
  if ((line.type ?? "EQUIPMENT") !== "EQUIPMENT" || line.status === "CANCELLED") return false;
  const c = lineUnitCounts(line);
  return c.out + c.back > 0;
}

type Names = { models: Map<string, Doc<"models">>; kits: Map<string, Doc<"kits">> };

function modelNameOf(line: Line, names: Names): string | null {
  return (line.modelId && names.models.get(line.modelId)?.name) || null;
}

function kitTagOf(line: Line, names: Names): string | null {
  return (line.kitId && names.kits.get(line.kitId)?.assetTag) || null;
}

function accessoryRow(k: Line, names: Names) {
  const c = lineUnitCounts(k);
  return { lineItemId: k.id, description: k.description ?? modelNameOf(k, names) ?? "Accessory", quantity: c.qty, out: c.out, back: c.back };
}

function lineRow(line: Line, kids: Line[], names: Names, late: Map<string, number>) {
  const c = lineUnitCounts(line);
  const kind = classifyLine(line);
  const modelName = modelNameOf(line, names);
  return {
    lineItemId: line.id,
    description: line.description ?? modelName ?? "Item",
    modelName,
    kind,
    quantity: c.qty,
    out: c.out,
    back: c.back,
    damaged: c.damaged,
    missing: c.missing,
    lateBack: late.get(line.id) ?? 0,
    scannable: kind !== "subhire" && kind !== "custom",
    kitId: line.kitId ?? null,
    kitAssetTag: kitTagOf(line, names),
    accessories: kids.map((k) => accessoryRow(k, names)),
  };
}

type LineRow = ReturnType<typeof lineRow>;

function sumOutcomes(rows: LineRow[]) {
  const t = { out: 0, back: 0, damaged: 0, missing: 0, lateBack: 0 };
  for (const r of rows) {
    t.out += r.out;
    t.back += r.back;
    t.damaged += r.damaged;
    t.missing += r.missing;
    t.lateBack += r.lateBack;
  }
  return t;
}

function groupRow({ job, lines }: JobLines, names: Names, late: Map<string, number>) {
  const kids = accessoriesByParent(lines);
  const rows = lines
    .filter(isListed)
    .map((l) => lineRow(l, kids.get(l.id) ?? [], names, late))
    .sort((a, b) => a.description.localeCompare(b.description));
  return {
    projectId: job.id,
    projectNumber: job.projectNumber,
    projectName: job.name,
    status: job.status ?? null,
    windowEnd: getProjectWindow(job).end ?? null,
    totals: sumOutcomes(rows),
    lines: rows,
  };
}

export const returning = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "warehouse");

    const { jobs, truncated: jobsTruncated } = await discoverJobs(ctx, orgId);

    // (d) LIVE-version lines per job. `by_versionId` is global; re-check org.
    const jobLines: JobLines[] = await Promise.all(
      jobs.map(async (job) => ({
        job,
        lines: (await versionRows(ctx, "projectLineItems", job.liveVersionId!)).filter((l) => l.organizationId === orgId),
      })),
    );
    const allLines = jobLines.flatMap((j) => j.lines);

    // (e) names, org-checked.
    const modelIds = [...new Set(allLines.map((l) => l.modelId).filter((m): m is string => !!m))];
    const kitIds = [...new Set(allLines.filter((l) => !l.isKitChild).map((l) => l.kitId).filter((k): k is string => !!k))];
    const [models, kits] = await Promise.all([
      loadOwn(ctx, "models", modelIds, orgId),
      loadOwn(ctx, "kits", kitIds, orgId),
    ]);

    // (f) late-back units.
    const endByProject = new Map(jobs.map((j) => [j.id, getProjectWindow(j).end ?? null]));
    const { late, truncated: unitsTruncated } = await lateBackByLine(
      ctx,
      orgId,
      allLines.filter(isListed),
      (l) => endByProject.get(l.projectId) ?? null,
    );

    const groups = jobLines
      .map((j) => groupRow(j, { models, kits }, late))
      .filter((g) => g.lines.length > 0)
      .sort((a, b) => (a.windowEnd ?? Infinity) - (b.windowEnd ?? Infinity));

    return {
      groups,
      totals: sumOutcomes(groups.flatMap((g) => g.lines)),
      truncated: jobsTruncated || unitsTruncated,
    };
  },
});

/** One line's units for the Returning row's unit chips (every unit, not only
 *  out ones, each with its outcome). Line, project and assets are org-checked. */
export const lineUnits = query({
  args: { orgId: v.string(), lineItemId: v.string() },
  handler: async (ctx, { orgId, lineItemId }) => {
    await requireOrgReadFor(ctx, orgId, "warehouse");

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
    if (!line || line.organizationId !== orgId) return null;
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", line.projectId)).first();
    if (!project || project.organizationId !== orgId) return null;

    // `by_lineItemId` is global: org-check the unit rows too.
    const read = await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
      .take(MAX_UNITS_PER_LINE);
    const units = read.filter((u) => u.organizationId === orgId);
    const assetIds = [...new Set(units.map((u) => u.assetId).filter((a): a is string => !!a))];
    const assets = await loadOwn(ctx, "assets", assetIds, orgId);
    const windowEnd = getProjectWindow(project).end ?? null;

    return {
      windowEnd,
      truncated: read.length >= MAX_UNITS_PER_LINE,
      units: units
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((u) => unitRow(u, (u.assetId && assets.get(u.assetId)?.assetTag) || null, windowEnd)),
    };
  },
});

function unitRow(u: Doc<"projectLineItemUnits">, assetTag: string | null, windowEnd: number | null) {
  return {
    unitId: u.id,
    assetId: u.assetId ?? null,
    assetTag,
    quantity: u.quantity ?? 1,
    returnedQuantity: u.returnedQuantity ?? 0,
    status: u.status ?? null,
    returnCondition: u.returnCondition ?? null,
    returnStatus: u.returnStatus ?? null,
    returnedAt: u.returnedAt ?? null,
    lateBack: returnedLate(u, windowEnd),
  };
}
