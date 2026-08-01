/**
 * Per-project readiness aggregation — the pure core behind the Overview tab's
 * "Readiness" checklist (#1061).
 *
 * The org-wide risk board (`overbookingBoard.ts`) answers "what's broken
 * ANYWHERE in the next 30 days"; the confirm-time gate
 * (`overbookingConfirmImpact.ts`) answers "what would break if I confirmed
 * THIS project". Neither answers the question the project's home page asks:
 * "is THIS project, as it stands right now, ready to go out the door?" — that
 * needs the project's ACTUAL status (not a simulated `CONFIRMED`) and it needs
 * rows, not just counts, so each failing check can carry the action that fixes
 * it.
 *
 * Everything here is a pure function over plain JS objects — no `ctx.db` — so
 * the whole aggregation is unit-testable without a Convex harness. The reads
 * live in `convex/projectReadiness.ts`.
 *
 * Deliberately NOT re-implemented here (one definition per rule, R-3.1):
 *   - double-booked serialized assets → `reservationConflicts.projectConflicts`
 *   - stale auto-pricing            → `lineItemWrites.projectPricingStaleness`
 * The checklist UI subscribes to those two existing queries alongside this one
 * rather than growing a second copy of either rule.
 */
import {
  computeGearShortageBoard,
  type DateRange,
  type BoardProject,
  type BoardLineItem,
  type BoardModel,
  type BoardAsset,
  type BoardBulkAsset,
  type BoardAssignment,
  type BoardService,
  type GearShortageRow,
  type MissingCrewRow,
  computeServicesMissingCrew,
} from "./overbookingBoard";
import { EXCLUDED_ASSIGNMENT_STATUSES } from "./crewConflicts";

/**
 * The models THIS project actually books as real (non-optional, non-cancelled,
 * non-sub-hire) demand. Shared with `overbookingConfirmImpact.ts` so the
 * confirm-time gate and the readiness checklist can never disagree about which
 * shortages are "this project's problem" — a sub-hired or optional line is
 * covered by definition, and a shortage on a model this project doesn't touch
 * belongs on the org board, not here.
 */
export function ownGearModelIds(projectId: string, lineItems: BoardLineItem[]): Set<string> {
  return new Set(
    lineItems
      .filter(
        (li) =>
          li.projectId === projectId &&
          li.modelId &&
          (li.status ?? "") !== "CANCELLED" &&
          li.subHireId == null &&
          li.isOptional !== true,
      )
      .map((li) => li.modelId!),
  );
}

export interface ReadinessGearSection {
  /** Hard shortages on models this project books — already-committed problems. */
  hard: GearShortageRow[];
  /** Additional shortage that appears if every pencilled booking also goes hard. */
  pencilled: GearShortageRow[];
  hardQty: number;
  pencilledQty: number;
}

/**
 * Gear shortage for one project's own models, computed from the REAL statuses
 * the caller passes (unlike the confirm-time gate, which simulates this project
 * as `CONFIRMED`). A project still in `ENQUIRY` therefore reports its demand as
 * pencilled — which is the honest answer for a job nobody has committed to yet,
 * and the reason the checklist labels the two tiers differently.
 */
export function computeProjectGearReadiness(
  projectId: string,
  window: DateRange,
  projects: BoardProject[],
  lineItems: BoardLineItem[],
  models: BoardModel[],
  assets: BoardAsset[],
  bulkAssets: BoardBulkAsset[],
): ReadinessGearSection {
  const empty: ReadinessGearSection = { hard: [], pencilled: [], hardQty: 0, pencilledQty: 0 };
  const ownModelIds = ownGearModelIds(projectId, lineItems);
  if (ownModelIds.size === 0) return empty;

  const board = computeGearShortageBoard(window, projects, lineItems, models, assets, bulkAssets);
  const hard = board.hard.filter((r) => ownModelIds.has(r.modelId));
  const pencilled = board.pencilled.filter((r) => ownModelIds.has(r.modelId));
  return {
    hard,
    pencilled,
    hardQty: hard.reduce((sum, r) => sum + r.qty, 0),
    pencilledQty: pencilled.reduce((sum, r) => sum + r.qty, 0),
  };
}

export interface ReadinessCrewSection {
  /** Assignments awaiting a yes — not CONFIRMED, and not settled-no. */
  unconfirmedCount: number;
  /** Every assignment that still counts as filling a slot (excludes settled-no). */
  activeCount: number;
  /** Services below their own `crewCountRequired`. */
  servicesMissingCrew: MissingCrewRow[];
  /** Total heads still needed across those services. */
  crewShortfall: number;
  /** Services still `PLANNED` — the work itself isn't locked in yet. */
  unconfirmedServices: { id: string; title: string; date: number | null }[];
  /** Services that count toward confirmation (excludes CANCELLED). */
  activeServiceCount: number;
}

/**
 * A service is "not confirmed" only while `PLANNED`. `IN_PROGRESS` and
 * `COMPLETED` are past confirmation — flagging them would nag about work
 * already underway — and `CANCELLED` is settled-no, so it drops out of both
 * the flagged list and the denominator. An absent status is treated as
 * `PLANNED`, the pre-status default.
 */
const SERVICE_SETTLED_STATUSES = new Set(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]);

/**
 * Crew readiness for one project: how many assigned people haven't said yes,
 * and which services are still under-staffed.
 *
 * `DECLINED`/`CANCELLED` are settled-no, not "unconfirmed" — they're excluded
 * from BOTH counts, which is why a declined assignment shrinks `activeCount`
 * (the service is short a head) rather than inflating `unconfirmedCount` (there
 * is nobody left to chase on that row). Services carry no date filter here: the
 * whole project is in scope on its own page, unlike the org board's range.
 */
export function computeProjectCrewReadiness(
  projectId: string,
  assignments: BoardAssignment[],
  services: BoardService[],
  project: { id: string; name: string; projectNumber: string },
): ReadinessCrewSection {
  const own = assignments.filter((a) => a.projectId === projectId);
  const active = own.filter((a) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "PENDING"));
  const unconfirmedCount = active.filter((a) => (a.status ?? "PENDING") !== "CONFIRMED").length;

  const assignmentsByServiceId = new Map<string, BoardAssignment[]>();
  for (const a of own) {
    if (!a.serviceId) continue;
    const list = assignmentsByServiceId.get(a.serviceId);
    if (list) list.push(a);
    else assignmentsByServiceId.set(a.serviceId, [a]);
  }

  // The board's range filter is deliberately bypassed — an under-staffed
  // service is this project's problem whether or not it falls inside some
  // 30-day window — so an all-encompassing range is passed instead of
  // duplicating `missingCrewRowFor`'s shortfall rule here (R-3.1).
  const everything: DateRange = { start: -8_640_000_000_000_000, end: 8_640_000_000_000_000 };
  const ownServices = services.filter((s) => s.projectId === projectId);
  const servicesMissingCrew = computeServicesMissingCrew(
    everything,
    ownServices,
    assignmentsByServiceId,
    new Map([[project.id, project]]),
  );

  const liveServices = ownServices.filter((s) => (s.status ?? "PLANNED") !== "CANCELLED");
  const unconfirmedServices = liveServices
    .filter((s) => !SERVICE_SETTLED_STATUSES.has(s.status ?? "PLANNED"))
    .map((s) => ({ id: s.id, title: s.title, date: s.date ?? null }))
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

  return {
    unconfirmedCount,
    activeCount: active.length,
    unconfirmedServices,
    activeServiceCount: liveServices.length,
    servicesMissingCrew,
    crewShortfall: servicesMissingCrew.reduce((sum, r) => sum + r.shortfall, 0),
  };
}

export interface ReadinessPricedRow {
  id: string;
  /** Line description / model name, or the group's title. */
  label: string;
  kind: "LINE" | "GROUP";
}

export interface ReadinessPricingSection {
  unpriced: ReadinessPricedRow[];
  unpricedCount: number;
}

export interface PricingLineInput {
  id: string;
  projectId: string;
  description?: string | null;
  modelName?: string | null;
  pricedUnderLock?: boolean | null;
  isKitChild?: boolean | null;
  status?: string | null;
}

export interface PricingGroupInput {
  id: string;
  projectId: string;
  title: string;
  pricedUnderLock?: boolean | null;
}

/**
 * Lines and groups the server forced to $0 by a lifecycle lock's
 * `defaultToZero` guard — i.e. added after the financials were locked and
 * never deliberately priced since.
 *
 * `pricedUnderLock` is the server's own record of that reset, NOT an inference
 * from "locked and currently $0" — the same distinction `equipment-rows.tsx`'s
 * `UnpricedBadge` makes, and for the same reason: a line that has legitimately
 * been $0 since before any lock existed is not a pricing gap. Kit children are
 * excluded because they are never independently priced by design.
 */
function isUnpricedLine(li: PricingLineInput, projectId: string): boolean {
  if (li.projectId !== projectId) return false;
  if (!li.pricedUnderLock || li.isKitChild) return false;
  return (li.status ?? "") !== "CANCELLED";
}

export function computeProjectPricingReadiness(
  projectId: string,
  lines: PricingLineInput[],
  groups: PricingGroupInput[],
): ReadinessPricingSection {
  const unpriced: ReadinessPricedRow[] = [
    ...lines
      .filter((li) => isUnpricedLine(li, projectId))
      .map((li): ReadinessPricedRow => ({
        id: li.id,
        label: li.description || li.modelName || "Line item",
        kind: "LINE",
      })),
    ...groups
      .filter((g) => g.projectId === projectId && g.pricedUnderLock)
      .map((g): ReadinessPricedRow => ({ id: g.id, label: g.title, kind: "GROUP" })),
  ];
  return { unpriced, unpricedCount: unpriced.length };
}
