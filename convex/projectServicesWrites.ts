import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertFinite } from "./lib/moneyGuards";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals, orgDefaultTaxRate } from "./lib/recalc";
import { recalcServiceCostFromCrew, recalcServiceChargeFromCrew } from "./lib/serviceCost";
import { bumpCountersForTable } from "./lib/counters";
import { resolveRate, calculateEstimatedCost } from "./lib/crewRate";
import { rateInputs, assertCrewMoney } from "./crewAssignmentsWrites";
import { getProjectWindow } from "./lib/projectWindow";
import * as enums from "./lib/validators";
import { assertLifecycleGuard, lifecycleAuditMetadata } from "./lib/projectLocks";

/**
 * Native PROJECT-SERVICE write mutations (Phase 3 browser-direct — replaces the
 * create/update/delete/status/bulk/generate/clone/convert ProjectService server
 * actions + the 3 template CRUD actions in src/server/project-services.ts).
 *
 * Service CRUD/status/bulk/orchestration gate on `project:update` (exact parity with
 * the deleted actions' requirePermission("project","update")); the template CRUD
 * gates on `orgSettings:update`.
 *
 * These are RECALC-COUPLED + crew fan-out: every write that changes booked service
 * revenue folds the in-mutation recalcProjectTotals (byte-for-byte the server's
 * recalculateProjectTotals) into the SAME transaction. The org default tax rate lives
 * in Postgres (no Convex mirror writer) — read inline from the orgSettings mirror.
 *
 * ★ convertLineItemToServiceNative does NOT recalc — the server action doesn't either
 *   (looks like a latent stale-total bug, but this is intentional parity, NOT a fix).
 *
 * Carve-outs that STAY server-side (untouched): updateServiceCrewStatus (its OFFERED
 * branch calls sendCrewOffer — crypto + email + Prisma), generateCrewMessage (live
 * preview read), and the 3 live reads (getProjectServices / …Summary / getServiceTemplates).
 *
 * The requireService mirrors in projectServices.ts / crewAssignments.ts /
 * serviceTemplates.ts are intentionally UNTOUCHED.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const DAY = 86_400_000;
const MULTI_DAY_TYPES = new Set(["BUMP_IN", "BUMP_OUT", "LABOUR"]);

// SERVICE_TYPE_LABELS — inlined from src/lib/constants/services.ts so the audit
// summaries are byte-identical to the deleted server actions'.
const SERVICE_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

const round = (v: number): number => Math.round(v * 100) / 100;

// ─── Compute helpers (byte-for-byte port of buildServiceData / deriveCrewTimes /
//     serviceTypeToPhase / calculateServiceLineTotal from src/server/project-services.ts) ─

function calculateServiceLineTotal(
  unitPrice: number | undefined,
  discount: number | undefined,
): number | null {
  if (unitPrice == null || unitPrice === 0) return null;
  // Clamp the discount non-negative here too (defense-in-depth): a negative discount must
  // never add to the line total even if a caller reaches this without the guard above.
  const disc = Math.max(0, discount ?? 0);
  return Math.max(0, round(unitPrice - disc));
}

function serviceTypeToPhase(type: string): string {
  switch (type) {
    case "DELIVERY": return "DELIVERY";
    case "PICKUP": return "PICKUP";
    case "BUMP_IN": return "BUMP_IN";
    case "BUMP_OUT": return "BUMP_OUT";
    case "LABOUR": return "EVENT";
    default: return "FULL_DURATION"; // MISC
  }
}

/** DELIVERY/PICKUP with no crew work window default to scheduledTime → +1 hr. */
function deriveCrewTimes(
  startTime: string | undefined,
  endTime: string | undefined,
  scheduledTime: string | undefined,
  type: string,
): { crewStart: string | null; crewEnd: string | null } {
  if (startTime) return { crewStart: startTime, crewEnd: endTime || null };
  if ((type === "DELIVERY" || type === "PICKUP") && scheduledTime) {
    const [h, m] = scheduledTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    const padded = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return { crewStart: scheduledTime, crewEnd: padded };
  }
  return { crewStart: null, crewEnd: null };
}

// Shared service-input args (create + update). Dates are epoch-ms; the hook parses
// with projectServiceSchema, converts Date→ms, null lat/long→omit, ""pricingType→omit.
const serviceInputArgs = {
  type: enums.ServiceType,
  title: v.string(),
  description: v.optional(v.string()),
  notes: v.optional(v.string()),
  date: v.optional(v.number()),
  endDate: v.optional(v.number()),
  startTime: v.optional(v.string()),
  endTime: v.optional(v.string()),
  scheduledTime: v.optional(v.string()),
  estimatedDuration: v.optional(v.number()),
  address: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  showOnDocuments: v.boolean(),
  unitPrice: v.optional(v.number()),
  quantity: v.number(),
  pricingType: v.optional(enums.PricingType),
  duration: v.optional(v.number()),
  discount: v.optional(v.number()),
  costTotal: v.optional(v.number()),
  // Charge-side auto-pricing override (WS10 #949) — see buildServiceFields / schema.ts.
  chargeRateOverride: v.optional(v.number()),
  taxable: v.boolean(),
  vehicleDescription: v.optional(v.string()),
  numberOfTrips: v.optional(v.number()),
  crewCountRequired: v.optional(v.number()),
  crewRoleId: v.optional(v.string()),
  xeroAccountCode: v.optional(v.string()),
  xeroTaxType: v.optional(v.string()),
};

type ServiceInput = {
  type: string;
  title: string;
  description?: string;
  notes?: string;
  date?: number;
  endDate?: number;
  startTime?: string;
  endTime?: string;
  scheduledTime?: string;
  estimatedDuration?: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  showOnDocuments: boolean;
  unitPrice?: number;
  quantity: number;
  pricingType?: string;
  duration?: number;
  discount?: number;
  costTotal?: number;
  chargeRateOverride?: number;
  taxable: boolean;
  vehicleDescription?: string;
  numberOfTrips?: number;
  crewCountRequired?: number;
  crewRoleId?: string;
  xeroAccountCode?: string;
  xeroTaxType?: string;
};

/**
 * Mirrors `projectServiceSchema`'s (src/lib/validations/project-service.ts) `quantity`
 * lower bound — `v.number()` only enforces type, not `.min(1)`. `title` presence is
 * already enforced separately (`if (!a.title) throw ...` in createServiceNative/
 * updateServiceNative/createServiceTemplateNative/updateServiceTemplateNative); money
 * bounds (`unitPrice`/`discount`/`costTotal` non-negative + finite) are already
 * enforced just below. `quantity` was the one bound neither path re-checked.
 */
function assertServiceFields(f: { quantity?: number; xeroAccountCode?: string; xeroTaxType?: string }): void {
  assertNumRange(f.quantity, "quantity", { min: 1 });
  assertStrLen(f.xeroAccountCode, "xeroAccountCode", { max: 50 });
  assertStrLen(f.xeroTaxType, "xeroTaxType", { max: 50 });
}

/** Port of buildServiceData — clamps endDate by type, computes lineTotal, and returns
 *  the normalized `fields` (null = cleared) plus the clamped serviceDate/serviceEndDate. */
function buildServiceFields(a: ServiceInput) {
  // Reject non-finite money before it reaches calculateServiceLineTotal / recalcProjectTotals
  // (serviceRevenue += num(lineTotal), serviceCostTotal += num(costTotal) → project.total/
  // margin = NaN). Browser-direct bypasses the server Zod that used to catch this.
  assertFinite(a.unitPrice, "unitPrice");
  assertFinite(a.discount, "discount");
  assertFinite(a.costTotal, "costTotal");
  assertFinite(a.chargeRateOverride, "chargeRateOverride");
  assertServiceFields({ quantity: a.quantity, xeroAccountCode: a.xeroAccountCode, xeroTaxType: a.xeroTaxType });
  // Bound money NON-NEGATIVE (browser-direct bypasses the server Zod min(0)). A negative
  // discount would INFLATE the customer-facing service line total (max(0, unitPrice - disc)
  // → serviceRevenue → project total); a negative costTotal would INFLATE project margin
  // (margin = total - costs). Both are money forgery, so reject them.
  if (a.unitPrice != null && a.unitPrice < 0)
    throw new ConvexError({ code: "INVALID_MONEY", message: "Service unit price cannot be negative." });
  if (a.discount != null && a.discount < 0)
    throw new ConvexError({ code: "INVALID_MONEY", message: "Service discount cannot be negative." });
  if (a.costTotal != null && a.costTotal < 0)
    throw new ConvexError({ code: "INVALID_MONEY", message: "Service cost cannot be negative." });
  if (a.chargeRateOverride != null && a.chargeRateOverride < 0)
    throw new ConvexError({ code: "INVALID_MONEY", message: "Charge rate override cannot be negative." });
  const serviceDate = a.date ?? null;
  let serviceEndDate = a.endDate ?? serviceDate;
  if (!MULTI_DAY_TYPES.has(a.type)) serviceEndDate = serviceDate;
  if (serviceDate != null && serviceEndDate != null && serviceEndDate < serviceDate) {
    serviceEndDate = serviceDate;
  }
  const lineTotal = calculateServiceLineTotal(a.unitPrice, a.discount);
  const fields = {
    type: a.type,
    title: a.title,
    description: a.description || null,
    notes: a.notes || null,
    date: serviceDate,
    endDate: serviceEndDate,
    startTime: a.startTime || null,
    endTime: a.endTime || null,
    scheduledTime: a.scheduledTime || null,
    estimatedDuration: a.estimatedDuration || null,
    address: a.address || null,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    showOnDocuments: a.showOnDocuments,
    unitPrice: a.unitPrice ?? null,
    quantity: a.quantity,
    pricingType: a.pricingType && String(a.pricingType) !== "" ? a.pricingType : null,
    duration: a.duration ?? null,
    discount: a.discount ?? null,
    lineTotal,
    costTotal: a.costTotal ?? null,
    chargeRateOverride: a.chargeRateOverride ?? null,
    taxable: a.taxable,
    vehicleDescription: a.vehicleDescription || null,
    numberOfTrips: a.numberOfTrips || null,
    crewCountRequired: a.crewCountRequired || null,
    crewRoleId: a.crewRoleId || null,
    xeroAccountCode: a.xeroAccountCode || null,
    xeroTaxType: a.xeroTaxType || null,
  };
  return { fields, serviceDate, serviceEndDate, lineTotal };
}

// ─── FK / org-scope validation helpers (by_cuid / by_projectId are GLOBAL) ────

async function requireProjectInOrg(ctx: MutationCtx, projectId: string, orgId: string): Promise<Doc<"projects">> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError("Project not found");
  return p;
}

async function requireServiceInOrg(ctx: MutationCtx, id: string, orgId: string): Promise<Doc<"projectServices">> {
  const s = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!s || s.organizationId !== orgId) throw new ConvexError("Service not found");
  return s;
}

async function assertCrewMemberInOrg(ctx: MutationCtx, crewMemberId: string, orgId: string): Promise<void> {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", crewMemberId)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("Crew member not found");
}

async function assertCrewRoleInOrg(ctx: MutationCtx, crewRoleId: string, orgId: string): Promise<void> {
  const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", crewRoleId)).first();
  if (!r || r.organizationId !== orgId) throw new ConvexError("Crew role not found");
}

/** Non-throwing org-membership checks — used by clone to DROP stale/foreign FKs rather
 *  than propagate a dangling reference into the target project. */
async function isCrewMemberInOrg(ctx: MutationCtx, id: string, orgId: string): Promise<boolean> {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return !!m && m.organizationId === orgId;
}
async function isCrewRoleInOrg(ctx: MutationCtx, id: string, orgId: string): Promise<boolean> {
  const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return !!r && r.organizationId === orgId;
}

// ─── Cascade helpers (mirror crewAssignments / projectServices cascades) ──────

/** Delete an assignment + its shifts + its (org-scoped) linked time entries + counter bump. */
async function cascadeDeleteAssignment(ctx: MutationCtx, doc: Doc<"crewAssignments">, orgId: string): Promise<void> {
  const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", doc.id)).collect();
  for (const s of shifts) await ctx.db.delete(s._id);
  const entries = (await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", doc.id)).collect())
    .filter((e) => e.organizationId === orgId);
  for (const e of entries) await ctx.db.delete(e._id);
  await ctx.db.delete(doc._id);
  await bumpCountersForTable(ctx, "crewAssignments", doc, null);
}

/** Cascade-delete a (synthetic) line item: its children + all their units + the line. */
async function cascadeDeleteLineItem(ctx: MutationCtx, lineItemId: string): Promise<void> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!line) return;
  const children = await ctx.db
    .query("projectLineItems")
    .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id))
    .collect();
  for (const c of [...children, line]) {
    const units = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", c.id)).collect();
    for (const u of units) await ctx.db.delete(u._id);
    await ctx.db.delete(c._id);
  }
}

/** Full per-service cascade (mirrors deleteProjectService + removeManyCascade): the
 *  synthetic line item (+ children + units), the crew assignments (+ shifts + time
 *  entries + counters), then the service itself. */
async function cascadeDeleteService(ctx: MutationCtx, service: Doc<"projectServices">, orgId: string): Promise<void> {
  if (service.lineItemId) await cascadeDeleteLineItem(ctx, service.lineItemId);
  const assignments = await ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", service.id)).collect();
  for (const a of assignments) await cascadeDeleteAssignment(ctx, a, orgId);
  await ctx.db.delete(service._id);
}

// ─── Crew-assignment insert (partial-unique (projectId, crewMemberId, serviceId) +
//     by_cuid idempotency + counter bump) — inlined from createManyServiceAssignments ─

async function insertServiceAssignment(
  ctx: MutationCtx,
  row: {
    id: string;
    organizationId: string;
    projectId: string;
    crewMemberId: string;
    serviceId: string;
    crewRoleId?: string;
    phase?: string;
    startDate?: number;
    startTime?: string;
    endDate?: number;
    endTime?: string;
    rateOverride?: number;
    rateType?: string;
    estimatedHours?: number;
    now: number;
  },
): Promise<{ estimatedCost: number }> {
  assertCrewMoney(row.rateOverride, "rateOverride");
  assertCrewMoney(row.estimatedHours, "estimatedHours");

  // Idempotent on retry: a row for this cuid that IS the same logical assignment → skip.
  // A cuid that collides with an UNRELATED assignment is a hard error, not a silent skip.
  const dupById = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", row.id)).first();
  if (dupById) {
    if (
      dupById.organizationId === row.organizationId &&
      dupById.projectId === row.projectId &&
      dupById.crewMemberId === row.crewMemberId &&
      dupById.serviceId === row.serviceId
    ) {
      return { estimatedCost: dupById.estimatedCost ?? 0 };
    }
    throw new ConvexError("Crew assignment already exists");
  }
  // Partial-unique (projectId, crewMemberId, serviceId) — this member already on this service → skip.
  const dupTriple = await ctx.db
    .query("crewAssignments")
    .withIndex("by_serviceId", (q) => q.eq("serviceId", row.serviceId))
    .filter((q) => q.and(q.eq(q.field("projectId"), row.projectId), q.eq(q.field("crewMemberId"), row.crewMemberId)))
    .first();
  if (dupTriple) return { estimatedCost: dupTriple.estimatedCost ?? 0 };

  // Rate cascade (rateOverride → crewMember day/hourly → crewRole default → $0) — the
  // SAME cascade a crew-panel-created assignment gets, so a service-added crew member's
  // cost isn't silently $0 until someone happens to edit it later (issue #796).
  const { crewMember, crewRole } = await rateInputs(ctx, row.organizationId, row.crewMemberId, row.crewRoleId);
  const { rate, rateType } = resolveRate(row.rateOverride, row.rateType ?? null, crewMember, crewRole);
  const estimatedCost = calculateEstimatedCost(rate, rateType, row.startDate ?? null, row.endDate ?? null, row.estimatedHours ?? null);

  const doc = {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    crewMemberId: row.crewMemberId,
    serviceId: row.serviceId,
    status: "PENDING" as const,
    ...(row.crewRoleId ? { crewRoleId: row.crewRoleId } : {}),
    ...(row.phase ? { phase: row.phase as Doc<"crewAssignments">["phase"] } : {}),
    ...(row.startDate != null ? { startDate: row.startDate } : {}),
    ...(row.startTime ? { startTime: row.startTime } : {}),
    ...(row.endDate != null ? { endDate: row.endDate } : {}),
    ...(row.endTime ? { endTime: row.endTime } : {}),
    ...(row.rateOverride != null ? { rateOverride: row.rateOverride } : {}),
    ...(row.rateType ? { rateType: row.rateType as Doc<"crewAssignments">["rateType"] } : {}),
    ...(row.estimatedHours != null ? { estimatedHours: row.estimatedHours } : {}),
    estimatedCost,
    createdAt: row.now,
    updatedAt: row.now,
  };
  await ctx.db.insert("crewAssignments", doc);
  await bumpCountersForTable(ctx, "crewAssignments", null, doc);
  return { estimatedCost };
}

async function logService(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; entityId: string; entityName: string; summary: string; projectId?: string; entityType?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: a.entityType ?? "service",
    entityId: a.entityId,
    entityName: a.entityName,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    metadata: a.metadata,
    projectId: a.projectId,
    createdAt: a.now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createServiceNative — insert projectServices (sortOrder max+1 among the project's
// services) + crew assignment inserts (partial-unique + counters), then recalc.
// Parity: createProjectService. project:update.
// ─────────────────────────────────────────────────────────────────────────────
export const createServiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    ...serviceInputArgs,
    crew: v.optional(v.array(v.object({
      id: v.string(),
      crewMemberId: v.string(),
      rateOverride: v.optional(v.number()),
      rateType: v.optional(enums.CrewRateType),
      estimatedHours: v.optional(v.number()),
    }))),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #793: required once the project is ON_SITE+ and no unlock session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    if (!a.title) throw new ConvexError("Title is required");
    const svcProject = await requireProjectInOrg(ctx, a.projectId, a.orgId);
    // #791: adding a crew-less service while locked defaults costTotal to $0
    // (server-enforced) — a crew-attached service's cost keeps auto-deriving from
    // the crew rate table below regardless (issue #796 single source of truth).
    // #793: adding is a structural mutation at JUSTIFY+.
    const guard = await assertLifecycleGuard(ctx, svcProject, { kind: "structural", justification: a.justification });
    if (guard.defaultToZero && (!a.crew || a.crew.length === 0)) {
      a.costTotal = 0;
    }
    // Validate the default crew role even when no crew members are attached (it's stored
    // on the service regardless — line ~406).
    if (a.crewRoleId) await assertCrewRoleInOrg(ctx, a.crewRoleId, a.orgId);

    // Idempotent ONLY for a true retry (same id, same org, same project). A cuid that
    // collides with an unrelated service (another project / org) is a hard error, not a
    // silent success — by_cuid is global + non-unique.
    const existing = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (existing) {
      if (existing.organizationId !== a.orgId || existing.projectId !== a.projectId) {
        throw new ConvexError("Service already exists");
      }
      return { id: a.id };
    }

    const { fields, serviceDate, serviceEndDate } = buildServiceFields(a);

    // sortOrder = max+1 among the project's existing services (by_projectId is global → org-filter).
    const projectServices = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect()
    ).filter((s) => s.organizationId === a.orgId);
    const sortOrder = projectServices.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1) + 1;

    await ctx.db.insert("projectServices", {
      id: a.id,
      organizationId: a.orgId,
      projectId: a.projectId,
      type: fields.type as Doc<"projectServices">["type"],
      title: fields.title,
      ...(fields.description != null ? { description: fields.description } : {}),
      ...(fields.notes != null ? { notes: fields.notes } : {}),
      ...(serviceDate != null ? { date: serviceDate } : {}),
      ...(serviceEndDate != null ? { endDate: serviceEndDate } : {}),
      ...(fields.startTime != null ? { startTime: fields.startTime } : {}),
      ...(fields.endTime != null ? { endTime: fields.endTime } : {}),
      ...(fields.scheduledTime != null ? { scheduledTime: fields.scheduledTime } : {}),
      ...(fields.estimatedDuration != null ? { estimatedDuration: fields.estimatedDuration } : {}),
      ...(fields.address != null ? { address: fields.address } : {}),
      ...(fields.latitude != null ? { latitude: fields.latitude } : {}),
      ...(fields.longitude != null ? { longitude: fields.longitude } : {}),
      showOnDocuments: fields.showOnDocuments,
      ...(fields.unitPrice != null ? { unitPrice: fields.unitPrice } : {}),
      quantity: fields.quantity,
      ...(fields.pricingType != null ? { pricingType: fields.pricingType as Doc<"projectServices">["pricingType"] } : {}),
      ...(fields.duration != null ? { duration: fields.duration } : {}),
      ...(fields.discount != null ? { discount: fields.discount } : {}),
      ...(fields.lineTotal != null ? { lineTotal: fields.lineTotal } : {}),
      ...(fields.costTotal != null ? { costTotal: fields.costTotal } : {}),
      ...(fields.chargeRateOverride != null ? { chargeRateOverride: fields.chargeRateOverride } : {}),
      taxable: fields.taxable,
      ...(fields.vehicleDescription != null ? { vehicleDescription: fields.vehicleDescription } : {}),
      ...(fields.numberOfTrips != null ? { numberOfTrips: fields.numberOfTrips } : {}),
      ...(fields.crewCountRequired != null ? { crewCountRequired: fields.crewCountRequired } : {}),
      ...(fields.crewRoleId != null ? { crewRoleId: fields.crewRoleId } : {}),
      ...(fields.xeroAccountCode != null ? { xeroAccountCode: fields.xeroAccountCode } : {}),
      ...(fields.xeroTaxType != null ? { xeroTaxType: fields.xeroTaxType } : {}),
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // Crew assignments (PENDING, partial-unique enforced, full rate cascade).
    if (a.crew && a.crew.length > 0) {
      const phase = serviceTypeToPhase(a.type);
      const { crewStart, crewEnd } = deriveCrewTimes(a.startTime, a.endTime, a.scheduledTime, a.type);
      if (a.crewRoleId) await assertCrewRoleInOrg(ctx, a.crewRoleId, a.orgId);
      for (const c of a.crew) {
        await assertCrewMemberInOrg(ctx, c.crewMemberId, a.orgId);
        await insertServiceAssignment(ctx, {
          id: c.id,
          organizationId: a.orgId,
          projectId: a.projectId,
          crewMemberId: c.crewMemberId,
          serviceId: a.id,
          ...(a.crewRoleId ? { crewRoleId: a.crewRoleId } : {}),
          phase,
          ...(serviceDate != null ? { startDate: serviceDate } : {}),
          ...(crewStart ? { startTime: crewStart } : {}),
          ...(serviceEndDate != null ? { endDate: serviceEndDate } : {}),
          ...(crewEnd ? { endTime: crewEnd } : {}),
          rateOverride: c.rateOverride,
          rateType: c.rateType,
          estimatedHours: c.estimatedHours,
          now: a.now,
        });
      }
      // Roll the crew's resolved cost up into costTotal — the service's own
      // manually-entered costTotal (set just above) only survives when it has NO
      // crew (issue #796 single source of truth). The charge twin (WS10 #949) does
      // the same for crewChargeTotal/lineTotal, protecting a manually-typed unitPrice.
      await recalcServiceCostFromCrew(ctx, a.id, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, a.id, a.orgId, a.now);
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "created", entityId: a.id, entityName: a.title,
      summary: `Created ${SERVICE_TYPE_LABELS[a.type]} service "${a.title}"`, projectId: a.projectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateServiceNative — patch/clear service + reconcile crew (remove de-selected w/
// cascade, add newly-selected, role-patch survivors) + cascade-delete a legacy
// lineItemId line, then recalc. Parity: updateProjectService. project:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateServiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    ...serviceInputArgs,
    // Present (even []) → reconcile crew. Absent → leave crew untouched.
    crew: v.optional(v.array(v.object({
      id: v.string(),
      crewMemberId: v.string(),
      rateOverride: v.optional(v.number()),
      rateType: v.optional(enums.CrewRateType),
      estimatedHours: v.optional(v.number()),
    }))),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #791/#793: required (one or the other, never both) once locked.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    if (!a.title) throw new ConvexError("Title is required");
    const existing = await requireServiceInOrg(ctx, a.id, a.orgId);

    // #791/#793 lock gate: this mutation resends the WHOLE service form (incl.
    // unchanged pricing) on every save, so "touches money" means the incoming
    // price fields actually DIFFER from the stored row, not merely present.
    const moneyChanged =
      (a.unitPrice ?? null) !== (existing.unitPrice ?? null) ||
      (a.discount ?? null) !== (existing.discount ?? null) ||
      (a.costTotal ?? null) !== (existing.costTotal ?? null);
    const svcUpdateProject = await requireProjectInOrg(ctx, existing.projectId, a.orgId);
    const guard = await assertLifecycleGuard(ctx, svcUpdateProject, {
      kind: moneyChanged ? "financial" : "structural",
      justification: a.justification,
    });

    const { fields, serviceDate, serviceEndDate } = buildServiceFields(a);

    // Patch the service (set + clear). "" / null-normalized fields clear.
    const set: Record<string, unknown> = {
      type: fields.type,
      title: fields.title,
      showOnDocuments: fields.showOnDocuments,
      quantity: fields.quantity,
      taxable: fields.taxable,
      updatedAt: a.now,
    };
    const clear: string[] = [];
    const setOrClear = (key: string, value: unknown) => {
      if (value == null) clear.push(key);
      else set[key] = value;
    };
    setOrClear("description", fields.description);
    setOrClear("notes", fields.notes);
    setOrClear("date", serviceDate);
    setOrClear("endDate", serviceEndDate);
    setOrClear("startTime", fields.startTime);
    setOrClear("endTime", fields.endTime);
    setOrClear("scheduledTime", fields.scheduledTime);
    setOrClear("estimatedDuration", fields.estimatedDuration);
    setOrClear("address", fields.address);
    setOrClear("latitude", fields.latitude);
    setOrClear("longitude", fields.longitude);
    setOrClear("unitPrice", fields.unitPrice);
    setOrClear("pricingType", fields.pricingType);
    setOrClear("duration", fields.duration);
    setOrClear("discount", fields.discount);
    setOrClear("lineTotal", fields.lineTotal);
    setOrClear("costTotal", fields.costTotal);
    setOrClear("chargeRateOverride", fields.chargeRateOverride);
    setOrClear("vehicleDescription", fields.vehicleDescription);
    setOrClear("numberOfTrips", fields.numberOfTrips);
    setOrClear("crewCountRequired", fields.crewCountRequired);
    setOrClear("crewRoleId", fields.crewRoleId);
    setOrClear("xeroAccountCode", fields.xeroAccountCode);
    setOrClear("xeroTaxType", fields.xeroTaxType);

    // Validate the default crew role even when no crew reconcile happens (it's patched
    // onto the service above regardless of the crew block below).
    if (fields.crewRoleId != null) await assertCrewRoleInOrg(ctx, fields.crewRoleId, a.orgId);

    const patch: Record<string, unknown> = { ...set };
    for (const k of clear) patch[k] = undefined;
    await ctx.db.patch(existing._id, patch);

    // Clean up any legacy linked line item (cascade delete + clear lineItemId).
    if (existing.lineItemId) {
      await cascadeDeleteLineItem(ctx, existing.lineItemId);
      await ctx.db.patch(existing._id, { lineItemId: undefined });
    }

    // Reconcile crew assignments (present → reconcile, absent → untouched).
    if (a.crew !== undefined) {
      const desiredByMember = new Map(a.crew.map((c) => [c.crewMemberId, c]));
      const existingAssignments = (
        await ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", a.id)).collect()
      ).filter((r) => r.organizationId === a.orgId);
      const existingMemberIds = new Set(existingAssignments.map((r) => r.crewMemberId));

      // Remove de-selected members' assignments (cascade shifts + time entries + counter).
      for (const asg of existingAssignments) {
        if (!desiredByMember.has(asg.crewMemberId)) await cascadeDeleteAssignment(ctx, asg, a.orgId);
      }

      // Add newly-selected members (partial-unique re-enforced per row).
      const phase = serviceTypeToPhase(a.type);
      const { crewStart, crewEnd } = deriveCrewTimes(a.startTime, a.endTime, a.scheduledTime, a.type);
      if (a.crewRoleId) await assertCrewRoleInOrg(ctx, a.crewRoleId, a.orgId);
      for (const c of a.crew) {
        if (existingMemberIds.has(c.crewMemberId)) continue; // survivor
        await assertCrewMemberInOrg(ctx, c.crewMemberId, a.orgId);
        await insertServiceAssignment(ctx, {
          id: c.id,
          organizationId: a.orgId,
          projectId: existing.projectId,
          crewMemberId: c.crewMemberId,
          serviceId: a.id,
          ...(a.crewRoleId ? { crewRoleId: a.crewRoleId } : {}),
          phase,
          ...(serviceDate != null ? { startDate: serviceDate } : {}),
          ...(crewStart ? { startTime: crewStart } : {}),
          ...(serviceEndDate != null ? { endDate: serviceEndDate } : {}),
          ...(crewEnd ? { endTime: crewEnd } : {}),
          rateOverride: c.rateOverride,
          rateType: c.rateType,
          estimatedHours: c.estimatedHours,
          now: a.now,
        });
      }

      // Survivors: always re-run the rate cascade + role patch (not just on role
      // change) — a rate-table edit in the dialog must land here too, and this is the
      // ONLY place that recomputes estimatedCost for an existing service-linked row
      // short of editing it directly from the crew side (issue #796).
      const newRoleId = a.crewRoleId || null;
      for (const asg of existingAssignments) {
        const c = desiredByMember.get(asg.crewMemberId);
        if (!c) continue; // was removed above
        assertCrewMoney(c.rateOverride, "rateOverride");
        assertCrewMoney(c.estimatedHours, "estimatedHours");
        const { crewMember, crewRole } = await rateInputs(ctx, a.orgId, asg.crewMemberId, newRoleId ?? undefined);
        const { rate, rateType } = resolveRate(c.rateOverride, c.rateType ?? null, crewMember, crewRole);
        const estimatedCost = calculateEstimatedCost(rate, rateType, serviceDate ?? null, serviceEndDate ?? null, c.estimatedHours ?? null);
        const patch: Record<string, unknown> = {
          updatedAt: a.now,
          crewRoleId: newRoleId ?? undefined,
          rateOverride: c.rateOverride ?? undefined,
          rateType: c.rateType ?? undefined,
          estimatedHours: c.estimatedHours ?? undefined,
          estimatedCost,
        };
        await ctx.db.patch(asg._id, patch);
        await bumpCountersForTable(ctx, "crewAssignments", asg, { ...asg, ...patch });
      }

      // Roll the crew's resolved cost up into costTotal (only while it HAS crew —
      // a crew-less service keeps its manually-entered costTotal untouched). The
      // charge twin (WS10 #949) does the same for crewChargeTotal/lineTotal.
      await recalcServiceCostFromCrew(ctx, a.id, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, a.id, a.orgId, a.now);
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, existing.projectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "updated", entityId: a.id, entityName: a.title,
      summary: `Updated ${SERVICE_TYPE_LABELS[a.type]} service "${a.title}"`, projectId: existing.projectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteServiceNative — full per-service cascade + recalc. Parity: deleteProjectService.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteServiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string(),
    // #793: required once the project is ON_SITE+ and no unlock session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const service = await requireServiceInOrg(ctx, a.id, a.orgId);
    const { projectId, title, type } = service;
    const delSvcProject = await requireProjectInOrg(ctx, projectId, a.orgId);
    const guard = await assertLifecycleGuard(ctx, delSvcProject, { kind: "structural", justification: a.justification });
    await cascadeDeleteService(ctx, service, a.orgId);

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, projectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "deleted", entityId: a.id, entityName: title,
      summary: `Deleted ${SERVICE_TYPE_LABELS[type]} service "${title}"`, projectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateServiceStatusNative — patch status + recalc. Parity: updateServiceStatus.
// ─────────────────────────────────────────────────────────────────────────────
export const updateServiceStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), status: enums.ServiceStatus, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const service = await requireServiceInOrg(ctx, a.id, a.orgId);
    // Parity: the server read the mapped service, whose status defaults to PLANNED
    // when the Convex doc has none (createProjectService never stamps a status).
    const oldStatus = service.status ?? "PLANNED";
    await ctx.db.patch(service._id, { status: a.status, updatedAt: a.now });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, service.projectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "status_changed", entityId: a.id, entityName: service.title,
      summary: `Changed ${service.title} status from ${oldStatus} to ${a.status}`, projectId: service.projectId,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkDeleteServicesNative — cascade-delete N services, recalc per project, one audit.
// Parity: bulkDeleteProjectServices. Empty guard.
// ─────────────────────────────────────────────────────────────────────────────
export const bulkDeleteServicesNative = mutation({
  returns: v.object({ deleted: v.number(), skipped: v.number() }),
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #988: required once a touched project is JUSTIFY+ and no session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { deleted: 0, skipped: 0 };

    const projectIds = new Set<string>();
    // #988: gate once per distinct project this selection touches (deleting is
    // structural — #793's JUSTIFY-tier per-edit gate, same "kind" a single
    // deleteServiceNative uses). Mirrors patchManyNative/removeManyNative's
    // per-project dedup for a multi-project bulk write.
    const guardedProjectIds = new Set<string>();
    let deleted = 0, skipped = 0;
    for (const id of a.ids) {
      const service = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!service || service.organizationId !== a.orgId) { skipped++; continue; }
      if (!guardedProjectIds.has(service.projectId)) {
        const svcProject = await requireProjectInOrg(ctx, service.projectId, a.orgId);
        await assertLifecycleGuard(ctx, svcProject, { kind: "structural", justification: a.justification });
        guardedProjectIds.add(service.projectId);
      }
      projectIds.add(service.projectId);
      await cascadeDeleteService(ctx, service, a.orgId);
      deleted++;
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    for (const pid of projectIds) await recalcProjectTotals(ctx, pid, a.orgId, taxRate, a.now);

    if (deleted > 0) {
      await logService(ctx, {
        orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
        action: "bulk_deleted", entityId: a.ids[0],
        entityName: `${deleted} service${deleted === 1 ? "" : "s"}`,
        summary: `Deleted ${deleted} service${deleted === 1 ? "" : "s"}`,
        projectId: [...projectIds][0],
      });
    }

    return { deleted, skipped };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkUpdateServiceStatusNative — patch status across N, recalc per project, one audit.
// Parity: bulkUpdateServiceStatus. Empty guard.
// ─────────────────────────────────────────────────────────────────────────────
export const bulkUpdateServiceStatusNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    status: enums.ServiceStatus,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #988: required once a touched project is JUSTIFY+ and no session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { updated: 0, skipped: 0 };

    const projectIds = new Set<string>();
    // #988: a status change is structural, gated once per distinct project.
    const guardedProjectIds = new Set<string>();
    let updated = 0, skipped = 0;
    for (const id of a.ids) {
      const service = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!service || service.organizationId !== a.orgId) { skipped++; continue; }
      if (!guardedProjectIds.has(service.projectId)) {
        const svcProject = await requireProjectInOrg(ctx, service.projectId, a.orgId);
        await assertLifecycleGuard(ctx, svcProject, { kind: "structural", justification: a.justification });
        guardedProjectIds.add(service.projectId);
      }
      await ctx.db.patch(service._id, { status: a.status, updatedAt: a.now });
      projectIds.add(service.projectId);
      updated++;
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    for (const pid of projectIds) await recalcProjectTotals(ctx, pid, a.orgId, taxRate, a.now);

    if (updated > 0) {
      await logService(ctx, {
        orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
        action: "bulk_status_changed", entityId: a.ids[0],
        entityName: `${updated} services`,
        summary: `Changed ${updated} services to ${a.status}`,
        projectId: [...projectIds][0],
      });
    }

    return { updated, skipped };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// generateServicesNative — read project/location/serviceTemplates, idempotent dedup
// by type:date, LABOUR multi-day fan-out, default-set fallback, N inserts, recalc.
// (No crew logic.) Parity: generateProjectServices. project:update.
// ─────────────────────────────────────────────────────────────────────────────

type GenTemplate = {
  type: string;
  title: string;
  description: string | null;
  defaultCrewCount: number | null;
  defaultVehicle: string | null;
  defaultPricingType: string | null;
  defaultUnitPrice: number | null;
  showOnDocuments: boolean;
};

/**
 * WS2 (#941) — service dates now derive from the PROJECT window (getProjectWindow),
 * not the deprecated loadIn/loadOut/event* fields: DELIVERY/BUMP_IN sit at the
 * window start (the old loadInDate role), BUMP_OUT/PICKUP at the window end (the
 * old loadOutDate role), and LABOUR/MISC span the whole window (the old
 * eventStartDate..eventEndDate role — the project window is the closest single
 * replacement now that the event pair is gone).
 */
function getServiceDateForType(
  type: string,
  window: { start: number | null; end: number | null },
): { date: number | null; endDate: number | null } {
  switch (type) {
    case "DELIVERY": return { date: window.start, endDate: window.start };
    case "BUMP_IN": return { date: window.start, endDate: window.start };
    case "BUMP_OUT": return { date: window.end, endDate: window.end };
    case "PICKUP": return { date: window.end, endDate: window.end };
    case "LABOUR": return { date: window.start, endDate: window.end ?? window.start };
    default: return { date: window.start, endDate: window.end ?? window.start }; // MISC
  }
}

const dayKeyOf = (ms: number | null): string => (ms != null ? new Date(ms).toISOString().slice(0, 10) : "null");

export const generateServicesNative = mutation({
  returns: v.object({ created: v.number() }),
  args: {
    orgId: v.string(),
    projectId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #988: required once the project is JUSTIFY+ and no session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const project = await requireProjectInOrg(ctx, a.projectId, a.orgId);
    // #988: generating is an add (structural) — a $0-priced template while
    // locked mirrors createServiceNative's own defaultToZero handling below.
    const guard = await assertLifecycleGuard(ctx, project, { kind: "structural", justification: a.justification });
    // WS2 (#941) — service generation reads the PROJECT window (falls back to
    // rental when unset), not the deprecated loadIn/loadOut/event* fields.
    const window = getProjectWindow(project);
    if (window.start == null) {
      throw new ConvexError("Project must have a project or rental start date to generate services");
    }

    let location: { address: string | null; latitude: number | null; longitude: number | null } | null = null;
    if (project.locationId) {
      const loc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", project.locationId!)).first();
      if (loc && loc.organizationId === a.orgId) {
        location = { address: loc.address ?? null, latitude: loc.latitude ?? null, longitude: loc.longitude ?? null };
      }
    }

    // Active templates (org-scoped), sorted by sortOrder.
    const templates: GenTemplate[] = (
      await ctx.db.query("serviceTemplates").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect() // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
    )
      .filter((t) => t.isActive ?? true)
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))
      .map((t) => ({
        type: t.type,
        title: t.title,
        description: t.description ?? null,
        defaultCrewCount: t.defaultCrewCount ?? null,
        defaultVehicle: t.defaultVehicle ?? null,
        defaultPricingType: t.defaultPricingType ?? null,
        defaultUnitPrice: t.defaultUnitPrice ?? null,
        showOnDocuments: t.showOnDocuments ?? false,
        _isAutoAdded: t.isAutoAdded ?? false,
      })) as (GenTemplate & { _isAutoAdded: boolean })[];

    const autoTemplates = (templates as (GenTemplate & { _isAutoAdded: boolean })[]).filter((t) => t._isAutoAdded);
    let templatesToUse: GenTemplate[] = autoTemplates.length > 0 ? autoTemplates : templates;

    if (templatesToUse.length === 0) {
      // No templates — default set.
      const defaultTypes = ["DELIVERY", "BUMP_IN", "BUMP_OUT", "PICKUP"];
      templatesToUse = defaultTypes.map((type) => ({
        type,
        title: SERVICE_TYPE_LABELS[type],
        description: null,
        defaultCrewCount: null,
        defaultVehicle: null,
        defaultPricingType: null,
        defaultUnitPrice: null,
        showOnDocuments: false,
      }));
      if (window.start != null) {
        templatesToUse.push({
          type: "LABOUR", title: "Show Day", description: null, defaultCrewCount: null,
          defaultVehicle: null, defaultPricingType: null, defaultUnitPrice: null, showOnDocuments: false,
        });
      }
    }

    // Existing services (idempotent dedup by type:date).
    const existingServices = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect()
    ).filter((s) => s.organizationId === a.orgId);
    const existingKey = new Set(existingServices.map((s) => `${s.type}:${dayKeyOf(s.date ?? null)}`));

    const toCreate: Array<{
      type: string; title: string; description: string | null; date: number | null; endDate: number | null;
      crewCountRequired: number | null; vehicleDescription: string | null; pricingType: string | null;
      unitPrice: number | null; showOnDocuments: boolean;
    }> = [];

    for (const tmpl of templatesToUse) {
      const { date, endDate } = getServiceDateForType(tmpl.type, window);
      if (date == null) continue;
      if (tmpl.type === "LABOUR" && endDate != null && endDate > date) {
        for (let cur = date; cur <= endDate; cur += DAY) {
          const key = `${tmpl.type}:${dayKeyOf(cur)}`;
          if (!existingKey.has(key)) {
            existingKey.add(key); // dedup WITHIN this batch too (two templates same type:date)
            toCreate.push({
              type: tmpl.type, title: tmpl.title, description: tmpl.description, date: cur, endDate: cur,
              crewCountRequired: tmpl.defaultCrewCount, vehicleDescription: tmpl.defaultVehicle,
              pricingType: tmpl.defaultPricingType || null, unitPrice: tmpl.defaultUnitPrice != null ? Number(tmpl.defaultUnitPrice) : null,
              showOnDocuments: tmpl.showOnDocuments,
            });
          }
        }
      } else {
        const key = `${tmpl.type}:${dayKeyOf(date)}`;
        if (!existingKey.has(key)) {
          existingKey.add(key); // dedup WITHIN this batch too (two templates same type:date)
          toCreate.push({
            type: tmpl.type, title: tmpl.title, description: tmpl.description, date, endDate: endDate ?? date,
            crewCountRequired: tmpl.defaultCrewCount, vehicleDescription: tmpl.defaultVehicle,
            pricingType: tmpl.defaultPricingType || null, unitPrice: tmpl.defaultUnitPrice != null ? Number(tmpl.defaultUnitPrice) : null,
            showOnDocuments: tmpl.showOnDocuments,
          });
        }
      }
    }

    if (toCreate.length === 0) return { created: 0 };

    // #988: locked with no open session — every generated service lands at
    // $0/unpriced, same as a manually-added one (createServiceNative).
    if (guard.defaultToZero) {
      for (const svc of toCreate) svc.unitPrice = null;
    }

    let sortOrder = existingServices.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1) + 1;
    let created = 0;
    for (const svc of toCreate) {
      const lineTotal = svc.unitPrice != null ? calculateServiceLineTotal(svc.unitPrice, 0) : null;
      await ctx.db.insert("projectServices", {
        id: createId(),
        organizationId: a.orgId,
        projectId: a.projectId,
        type: svc.type as Doc<"projectServices">["type"],
        title: svc.title,
        ...(svc.description != null ? { description: svc.description } : {}),
        ...(svc.date != null ? { date: svc.date } : {}),
        ...(svc.endDate != null ? { endDate: svc.endDate } : {}),
        ...(location?.address != null ? { address: location.address } : {}),
        ...(location?.latitude != null ? { latitude: location.latitude } : {}),
        ...(location?.longitude != null ? { longitude: location.longitude } : {}),
        ...(svc.crewCountRequired != null ? { crewCountRequired: svc.crewCountRequired } : {}),
        ...(svc.vehicleDescription != null ? { vehicleDescription: svc.vehicleDescription } : {}),
        ...(svc.pricingType != null ? { pricingType: svc.pricingType as Doc<"projectServices">["pricingType"] } : {}),
        ...(svc.unitPrice != null ? { unitPrice: svc.unitPrice } : {}),
        ...(lineTotal != null ? { lineTotal } : {}),
        showOnDocuments: svc.showOnDocuments,
        sortOrder: sortOrder++,
        createdAt: a.now,
        updatedAt: a.now,
      });
      created++;
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "generated", entityId: a.projectId, entityName: project.name,
      summary: `Generated ${created} services for ${project.projectNumber}`, projectId: a.projectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { created };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// cloneServicesNative — copy services + crew assignments from sourceProjectId →
// targetProjectId (BOTH org-checked), date-offset, status→PLANNED, recalc target.
// Parity: cloneServicesFromProject. project:update.
// ─────────────────────────────────────────────────────────────────────────────
export const cloneServicesNative = mutation({
  returns: v.object({ cloned: v.number() }),
  args: {
    orgId: v.string(),
    targetProjectId: v.string(),
    sourceProjectId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #988: required once the TARGET project is JUSTIFY+ and no session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const target = await requireProjectInOrg(ctx, a.targetProjectId, a.orgId);
    const source = await requireProjectInOrg(ctx, a.sourceProjectId, a.orgId);
    // #988: gated on the TARGET only — that's where the new (add) services
    // land; the source project isn't written to.
    const guard = await assertLifecycleGuard(ctx, target, { kind: "structural", justification: a.justification });

    const sourceServices = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", a.sourceProjectId)).collect()
    )
      .filter((s) => s.organizationId === a.orgId && s.status !== "CANCELLED")
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));

    if (sourceServices.length === 0) return { cloned: 0 };

    // Source crew assignments grouped by serviceId.
    const sourceAssignmentsByService = new Map<string, Doc<"crewAssignments">[]>();
    for (const asg of (
      await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", a.sourceProjectId)).collect()
    ).filter((r) => r.organizationId === a.orgId)) {
      if (!asg.serviceId) continue;
      const arr = sourceAssignmentsByService.get(asg.serviceId) ?? [];
      arr.push(asg);
      sourceAssignmentsByService.set(asg.serviceId, arr);
    }

    // Pre-validate the distinct crew member + role FKs the clone would copy: only carry
    // references that still resolve in THIS org (a deleted/foreign member/role is dropped,
    // never propagated into the target as a dangling/cross-tenant reference).
    const memberIds = new Set<string>();
    const roleIds = new Set<string>();
    for (const svc of sourceServices) if (svc.crewRoleId) roleIds.add(svc.crewRoleId);
    for (const arr of sourceAssignmentsByService.values()) {
      for (const asg of arr) { memberIds.add(asg.crewMemberId); if (asg.crewRoleId) roleIds.add(asg.crewRoleId); }
    }
    const validMembers = new Set<string>();
    for (const mid of memberIds) if (await isCrewMemberInOrg(ctx, mid, a.orgId)) validMembers.add(mid);
    const validRoles = new Set<string>();
    for (const rid of roleIds) if (await isCrewRoleInOrg(ctx, rid, a.orgId)) validRoles.add(rid);

    // WS2 (#941) — the day-shift between source/target project windows
    // (getProjectWindow; falls back to rental) replaces loadInDate ?? eventStartDate.
    const sourceFirst = getProjectWindow(source).start;
    const targetFirst = getProjectWindow(target).start;
    const dayOffset = sourceFirst != null && targetFirst != null ? Math.round((targetFirst - sourceFirst) / DAY) : 0;
    const offsetDate = (ms: number | null | undefined): number | null => {
      if (ms == null || dayOffset === 0) return ms ?? null;
      return ms + dayOffset * DAY;
    };

    const targetServices = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", a.targetProjectId)).collect()
    ).filter((s) => s.organizationId === a.orgId);
    let sortOrder = targetServices.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1) + 1;

    let cloned = 0;
    for (const svc of sourceServices) {
      const newServiceId = createId();
      const clonedDate = offsetDate(svc.date);
      const clonedEndDate = offsetDate(svc.endDate);
      // #988: locked target with no open session — the clone is an add, so its
      // copied money fields land at $0/unset exactly like a manually-added
      // service (createServiceNative), never the source's live pricing.
      const unitPrice = guard.defaultToZero ? null : (svc.unitPrice ?? null);
      const discount = guard.defaultToZero ? null : (svc.discount ?? null);
      const lineTotal = guard.defaultToZero ? null : (svc.lineTotal ?? null);
      const costTotal = guard.defaultToZero ? null : (svc.costTotal ?? null);
      const chargeRateOverride = guard.defaultToZero ? null : (svc.chargeRateOverride ?? null);
      const crewChargeTotal = guard.defaultToZero ? null : (svc.crewChargeTotal ?? null);
      await ctx.db.insert("projectServices", {
        id: newServiceId,
        organizationId: a.orgId,
        projectId: a.targetProjectId,
        type: svc.type,
        title: svc.title,
        ...(svc.description != null ? { description: svc.description } : {}),
        ...(svc.notes != null ? { notes: svc.notes } : {}),
        ...(clonedDate != null ? { date: clonedDate } : {}),
        ...(clonedEndDate != null ? { endDate: clonedEndDate } : {}),
        ...(svc.startTime != null ? { startTime: svc.startTime } : {}),
        ...(svc.endTime != null ? { endTime: svc.endTime } : {}),
        ...(svc.scheduledTime != null ? { scheduledTime: svc.scheduledTime } : {}),
        ...(svc.estimatedDuration != null ? { estimatedDuration: svc.estimatedDuration } : {}),
        ...(svc.address != null ? { address: svc.address } : {}),
        ...(svc.latitude != null ? { latitude: svc.latitude } : {}),
        ...(svc.longitude != null ? { longitude: svc.longitude } : {}),
        showOnDocuments: svc.showOnDocuments ?? false,
        ...(unitPrice != null ? { unitPrice } : {}),
        quantity: svc.quantity ?? 1,
        ...(svc.pricingType != null ? { pricingType: svc.pricingType } : {}),
        ...(svc.duration != null ? { duration: svc.duration } : {}),
        ...(discount != null ? { discount } : {}),
        ...(lineTotal != null ? { lineTotal } : {}),
        ...(costTotal != null ? { costTotal } : {}),
        // Charge-side fields copy verbatim, same as costTotal above — no recalc call
        // here (parity with the pre-existing cost-side clone behaviour).
        ...(chargeRateOverride != null ? { chargeRateOverride } : {}),
        ...(crewChargeTotal != null ? { crewChargeTotal } : {}),
        taxable: svc.taxable ?? true,
        ...(svc.vehicleDescription != null ? { vehicleDescription: svc.vehicleDescription } : {}),
        ...(svc.numberOfTrips != null ? { numberOfTrips: svc.numberOfTrips } : {}),
        ...(svc.crewCountRequired != null ? { crewCountRequired: svc.crewCountRequired } : {}),
        ...(svc.crewRoleId != null && validRoles.has(svc.crewRoleId) ? { crewRoleId: svc.crewRoleId } : {}),
        status: "PLANNED",
        sortOrder: sortOrder++,
        createdAt: a.now,
        updatedAt: a.now,
      });

      // Clone the crew assignments (partial-unique enforced, dates offset, PENDING).
      for (const asg of sourceAssignmentsByService.get(svc.id) ?? []) {
        // Drop an assignment whose member no longer resolves in this org (stale/foreign ref).
        if (!validMembers.has(asg.crewMemberId)) continue;
        await insertServiceAssignment(ctx, {
          id: createId(),
          organizationId: a.orgId,
          projectId: a.targetProjectId,
          crewMemberId: asg.crewMemberId,
          serviceId: newServiceId,
          ...(asg.crewRoleId && validRoles.has(asg.crewRoleId) ? { crewRoleId: asg.crewRoleId } : {}),
          ...(asg.phase ? { phase: asg.phase } : {}),
          ...((offsetDate(asg.startDate) ?? undefined) != null ? { startDate: offsetDate(asg.startDate)! } : {}),
          ...(asg.startTime ? { startTime: asg.startTime } : {}),
          ...((offsetDate(asg.endDate) ?? undefined) != null ? { endDate: offsetDate(asg.endDate)! } : {}),
          ...(asg.endTime ? { endTime: asg.endTime } : {}),
          now: a.now,
        });
      }
      cloned++;
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.targetProjectId, a.orgId, taxRate, a.now);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "cloned", entityId: a.targetProjectId, entityName: target.name,
      summary: `Cloned ${cloned} services from ${source.projectNumber} to ${target.projectNumber}`,
      projectId: a.targetProjectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { cloned };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// convertLineItemToServiceNative — read the line (org+project-checked), insert a
// service linked to lineItemId. ★ NO recalc (the server doesn't — intentional parity,
// a latent stale-total bug we replicate, NOT fix). Parity: convertLineItemToService.
// ─────────────────────────────────────────────────────────────────────────────
export const convertLineItemToServiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    serviceId: v.string(),
    orgId: v.string(),
    lineItemId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #988: required once the project is JUSTIFY+ and no session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", a.lineItemId)).first();
    if (!line || line.organizationId !== a.orgId) throw new ConvexError("Line item not found");
    const convertProject = await requireProjectInOrg(ctx, line.projectId, a.orgId);
    // #988: converting creates a new service (an add) linked to the line — its
    // copied pricing is gated the same way createServiceNative's is.
    const guard = await assertLifecycleGuard(ctx, convertProject, { kind: "structural", justification: a.justification });

    const typeMap: Record<string, string> = { TRANSPORT: "DELIVERY", LABOUR: "LABOUR", SERVICE: "MISC" };
    const serviceType = typeMap[line.type ?? "EQUIPMENT"] || "MISC";

    // Idempotent: a retried convert with the same service cuid short-circuits.
    const dup = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", a.serviceId)).first();
    if (dup) {
      // Idempotent ONLY for a true retry of THIS conversion (same org + same linked line).
      // A cuid that collides with an unrelated service is a hard error, not a silent success.
      if (dup.organizationId !== a.orgId || dup.lineItemId !== a.lineItemId) {
        throw new ConvexError("Service already exists");
      }
      return { id: a.serviceId };
    }

    const existingForProject = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", line.projectId)).collect()
    ).filter((s) => s.organizationId === a.orgId);
    const sortOrder = existingForProject.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1) + 1;

    const pricingType = line.pricingType && String(line.pricingType) !== "" ? line.pricingType : null;
    // #988: locked with no open session — the converted service is an add, so
    // its copied pricing lands at $0/unset, never the line's live price.
    const unitPrice = guard.defaultToZero ? null : (line.unitPrice ?? null);
    const discount = guard.defaultToZero ? null : (line.discount ?? null);
    const lineTotal = guard.defaultToZero ? null : (line.lineTotal ?? null);
    await ctx.db.insert("projectServices", {
      id: a.serviceId,
      organizationId: a.orgId,
      projectId: line.projectId,
      type: serviceType as Doc<"projectServices">["type"],
      title: line.description || SERVICE_TYPE_LABELS[serviceType],
      showOnDocuments: true,
      ...(unitPrice != null ? { unitPrice } : {}),
      quantity: line.quantity ?? 1,
      ...(pricingType ? { pricingType: pricingType as Doc<"projectServices">["pricingType"] } : {}),
      ...(line.duration ? { duration: Number(line.duration) } : {}),
      ...(discount != null ? { discount: Number(discount) } : {}),
      ...(lineTotal != null ? { lineTotal: Number(lineTotal) } : {}),
      lineItemId: line.id,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // ★ NO recalc — byte-for-byte parity with convertLineItemToService.

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "converted", entityId: a.serviceId, entityName: line.description || SERVICE_TYPE_LABELS[serviceType],
      summary: `Converted line item "${line.description}" to ${SERVICE_TYPE_LABELS[serviceType]} service`,
      projectId: line.projectId,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { id: a.serviceId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Service Template CRUD (orgSettings:update). serviceTemplates insert/replace/remove.
// No recalc (templates aren't project-scoped). Parity: create/update/deleteServiceTemplate.
// ─────────────────────────────────────────────────────────────────────────────

const templateInputArgs = {
  type: enums.ServiceType,
  title: v.string(),
  description: v.optional(v.string()),
  defaultCrewCount: v.optional(v.number()),
  defaultVehicle: v.optional(v.string()),
  defaultPricingType: v.optional(enums.PricingType),
  defaultUnitPrice: v.optional(v.number()),
  showOnDocuments: v.boolean(),
  isAutoAdded: v.boolean(),
  isActive: v.boolean(),
};

export const createServiceTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...templateInputArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "orgSettings", "update");
    const actor = await resolveActor(ctx, a.actor);
    assertFinite(a.defaultUnitPrice, "defaultUnitPrice"); // generateServicesNative copies it into unitPrice → recalc

    if (!a.title) throw new ConvexError("Title is required");

    // Idempotent: a retried create with the same cuid short-circuits.
    const existing = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (existing) {
      if (existing.organizationId !== a.orgId) throw new ConvexError("Template not found");
      return { id: a.id };
    }

    const templates = await ctx.db.query("serviceTemplates").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
    const sortOrder = templates.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), -1) + 1;
    const defaultPricingType = a.defaultPricingType && String(a.defaultPricingType) !== "" ? a.defaultPricingType : null;

    await ctx.db.insert("serviceTemplates", {
      id: a.id,
      organizationId: a.orgId,
      type: a.type,
      title: a.title,
      ...(a.description ? { description: a.description } : {}),
      ...(a.defaultCrewCount ? { defaultCrewCount: a.defaultCrewCount } : {}),
      ...(a.defaultVehicle ? { defaultVehicle: a.defaultVehicle } : {}),
      ...(defaultPricingType ? { defaultPricingType } : {}),
      ...(a.defaultUnitPrice != null ? { defaultUnitPrice: Number(a.defaultUnitPrice) } : {}),
      showOnDocuments: a.showOnDocuments,
      isAutoAdded: a.isAutoAdded,
      isActive: a.isActive,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, entityType: "serviceTemplate",
      action: "created", entityId: a.id, entityName: a.title,
      summary: `Created service template "${a.title}"`,
    });

    return { id: a.id };
  },
});

export const updateServiceTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...templateInputArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "orgSettings", "update");
    const actor = await resolveActor(ctx, a.actor);
    assertFinite(a.defaultUnitPrice, "defaultUnitPrice"); // generateServicesNative copies it into unitPrice → recalc

    if (!a.title) throw new ConvexError("Title is required");
    const doc = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Template not found");

    const defaultPricingType = a.defaultPricingType && String(a.defaultPricingType) !== "" ? a.defaultPricingType : null;

    // Full replace so absent optional fields are physically removed (parity: replaceForOrg).
    await ctx.db.replace(doc._id, {
      id: a.id,
      organizationId: a.orgId,
      type: a.type,
      title: a.title,
      ...(a.description ? { description: a.description } : {}),
      ...(a.defaultCrewCount ? { defaultCrewCount: a.defaultCrewCount } : {}),
      ...(a.defaultVehicle ? { defaultVehicle: a.defaultVehicle } : {}),
      ...(defaultPricingType ? { defaultPricingType } : {}),
      ...(a.defaultUnitPrice != null ? { defaultUnitPrice: Number(a.defaultUnitPrice) } : {}),
      showOnDocuments: a.showOnDocuments,
      isAutoAdded: a.isAutoAdded,
      isActive: a.isActive,
      sortOrder: doc.sortOrder ?? 0,
      createdAt: doc.createdAt,
      updatedAt: a.now,
    });

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, entityType: "serviceTemplate",
      action: "updated", entityId: a.id, entityName: a.title,
      summary: `Updated service template "${a.title}"`,
    });

    return { id: a.id };
  },
});

export const deleteServiceTemplateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectService");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "orgSettings", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Template not found");
    const title = doc.title;
    await ctx.db.delete(doc._id);

    await logService(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, entityType: "serviceTemplate",
      action: "deleted", entityId: a.id, entityName: title,
      summary: `Deleted service template "${title}"`,
    });

    return { id: a.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bulkDeleteServicesNative: { danger: "high" }, // cascade-deletes N services (+ crew assignments/shifts/time entries)
  bulkUpdateServiceStatusNative: { danger: "medium" },
  cloneServicesNative: { danger: "medium" },
  convertLineItemToServiceNative: { danger: "medium" },
  createServiceNative: { danger: "medium" },
  createServiceTemplateNative: { danger: "medium" },
  deleteServiceNative: { danger: "high" }, // full cascade delete: line item, crew assignments, shifts, time entries
  deleteServiceTemplateNative: { danger: "high" }, // delete/archive tier (§9) even though a template is recreatable
  generateServicesNative: { danger: "medium" },
  updateServiceNative: { danger: "medium" },
  updateServiceStatusNative: { danger: "medium" },
  updateServiceTemplateNative: { danger: "medium" },
};
