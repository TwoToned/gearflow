import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { callerMayRead, requireOrgReadFor } from "./lib/auth";
import { isConfirmedOrLater } from "./lib/availabilityCore";
import { loadSchedule } from "./lib/scheduleFetch";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * The Schedule's Jobs read (UX Phase 18, spec §9o.7, FEATUREDOCS/11): the jobs
 * whose RENTAL window overlaps `[startMs, endMs]`, each with the derived
 * `clash` / `would clash` word from the Overbookings board's own claim math
 * (`convex/lib/scheduleBoard.ts`), and its gear summary. ONE-SHOT-sized and
 * bounded: every document comes from one `ReadBudget` (`scheduleFetch.ts`), a
 * cut is reported as `truncated`, and a job whose check could not run says
 * `unknown`, never "no clash". The range is bounded (two months at most) and
 * comes from the URL's week or month, so the args are a stable subscription key.
 */
const MAX_RANGE_DAYS = 62;

export const jobs = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    if (!(await callerMayRead(ctx, orgId, "project"))) {
      throw new ConvexError({ code: "FORBIDDEN", message: "You do not have access to jobs." });
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > MAX_RANGE_DAYS * 86_400_000) {
      throw new ConvexError({ code: "INVALID_RANGE", message: `The schedule range must be 1 to ${MAX_RANGE_DAYS} days.` });
    }
    const { visible, facts, models, clientNames, truncated } = await loadSchedule(ctx, orgId, { start: startMs, end: endMs });
    return {
      truncated,
      models: models.map((m) => ({ id: m.id, name: m.name, categoryId: m.categoryId ?? null })),
      jobs: visible.map((p) => {
        const f = facts.get(p.id);
        return {
          id: p.id,
          projectNumber: p.projectNumber,
          name: p.name,
          status: p.status ?? "ENQUIRY",
          // Held = holds its gear (confirmed or later); pencilled holds nothing (availabilityCore).
          holds: isConfirmedOrLater(p.status),
          clientId: p.clientId ?? null,
          clientName: p.clientId ? (clientNames.get(p.clientId) ?? null) : null,
          projectManagerId: p.projectManagerId ?? null,
          rentalStart: p.rentalStartDate!,
          rentalEnd: p.rentalEndDate!,
          clash: f?.state ?? "unknown",
          clashes: f?.rows ?? [],
          modelCount: f?.modelCount ?? null,
          modelIds: f?.modelIds ?? [],
          lineCount: f?.lineCount ?? null,
          unitCount: f?.unitCount ?? null,
        };
      }),
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  jobs: {
    summary: "The jobs whose rental window overlaps a date range, each with a clash / would-clash flag derived from the overbooking engine.",
    danger: "low",
    mcpTier: 3,
  },
};
