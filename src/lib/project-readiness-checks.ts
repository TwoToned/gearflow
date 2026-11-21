/**
 * Turns the readiness data sources into the ordered list of checks the
 * Overview tab's readiness section renders (#1061; restored in UX Phase 7).
 *
 * A plain module, not a hook and not inside a `"use server"` file, so the
 * wording and severity rules are unit-testable without React or Convex — the
 * severity of a check decides whether the panel shouts or whispers, which is
 * exactly the kind of rule that rots silently if it only exists inside JSX.
 *
 * Three sources feed in, deliberately kept separate (R-3.1 — each rule has
 * exactly one home):
 *   - `projectReadiness.forProject`             → gear, crew, unpriced, packing, incidents
 *   - `reservationConflicts.projectConflicts`   → double-booked assets (one-shot)
 *   - `collaboration.getProjectBlockingSummary` → blocking discussions (the
 *     same count the header ⋯ shows; UX Phase 7 — Phase 10 must not rebuild it)
 *
 * Stale auto-pricing (`lineItemWrites.projectPricingStaleness`) is NOT one of
 * these checks — it's already surfaced by `StalePricingBanner` on the Finance
 * tab, and duplicating it here just repeated the same fact in two places.
 */

/**
 * `blocking` — a committed problem: gear this project is short, or an asset
 * booked twice. `warning` — real but not yet a violation (pencilled demand,
 * crew who haven't replied, a price nobody has set). `pass` — checked and
 * clean. `unknown` — the check could not run, and says so rather than
 * reporting a false all-clear.
 */
type ReadinessSeverity = "blocking" | "warning" | "pass" | "unknown";

export type ReadinessCheckId =
  | "gear"
  | "conflicts"
  | "discussions"
  | "crew"
  | "services"
  | "pricing"
  | "packing"
  | "incidents";

/**
 * Where a row's link goes — the surface that OWNS the fix. A tab key is the
 * job page's (`src/lib/job-tabs.ts`); `edit` is the job edit page (dates live
 * there until Phase 9's sheet); `warehouse` is the job's warehouse page;
 * `discussion` opens the comments panel the header ⋯ opens.
 */
export type ReadinessFix =
  | { kind: "tab"; tab: "equipment" | "labour" | "packing" }
  | { kind: "edit" }
  | { kind: "warehouse" }
  | { kind: "discussion" };

export interface ReadinessCheck {
  id: ReadinessCheckId;
  severity: ReadinessSeverity;
  /** One line, stating the finding — never a bare label like "Gear". */
  title: string;
  /** The specifics: which models, which assets, how many. */
  detail?: string;
  /** Label for the row's inline action; absent on a passing row. */
  actionLabel?: string;
  /** Where the action goes; absent on a passing row. */
  fix?: ReadinessFix;
}

const TAB_FIX = (tab: "equipment" | "labour" | "packing"): ReadinessFix => ({ kind: "tab", tab });

export interface ReadinessGearInput {
  hard: { modelName: string; qty: number }[];
  pencilled: { modelName: string; qty: number }[];
}

export interface ReadinessCrewInput {
  unconfirmedCount: number;
  activeCount: number;
  servicesMissingCrew: { title: string; shortfall: number }[];
  crewShortfall: number;
  unconfirmedServices: { title: string }[];
  activeServiceCount: number;
}

export interface ReadinessPricingInput {
  unpriced: { label: string }[];
  unpricedCount: number;
}

/** #1296 build plan phase 4 — see `computeProjectPackingReadiness`. */
export interface ReadinessPackingInput {
  totalCount: number;
  notPlannedCount: number;
}

export interface ReadinessConflictInput {
  assetTag: string;
  modelName: string;
  conflictingProject: { projectNumber: string };
}

/** `projectReadiness.forProject`'s bounded count (UX Phase 7). */
export interface ReadinessIncidentInput {
  openCount: number;
  /** The scan hit its cap; `openCount` is a floor. */
  truncated: boolean;
}

export interface BuildChecksInput {
  hasWindow: boolean;
  /** Preformatted rental window, e.g. "12 – 16 Aug" — omitted when dateless. */
  windowLabel?: string;
  gear: ReadinessGearInput;
  crew: ReadinessCrewInput;
  pricing: ReadinessPricingInput;
  /** `null` = the one-shot detection has not answered (still loading, or it
   *  failed) — reported as not checked, never as "no conflicts". */
  conflicts: ReadinessConflictInput[] | null;
  packing: ReadinessPackingInput;
  /** Absent on a pre-Phase-7 response shape: the row is dropped. */
  incidents?: ReadinessIncidentInput;
  /** Open blocking discussions; `null` while the count is loading. */
  blockingCount?: number | null;
}

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

/** "Shure ULXD4Q ×2, Maverick MK2 Spot ×1" — capped, with an honest remainder. */
function listModels(rows: { modelName: string; qty: number }[], cap = 3): string {
  const shown = rows.slice(0, cap).map((r) => `${r.modelName} ×${r.qty}`).join(", ");
  const rest = rows.length - cap;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

function gearCheck(input: BuildChecksInput): ReadinessCheck {
  const { gear, hasWindow, windowLabel } = input;
  // A dateless project has no window to compare other bookings against. Saying
  // "enough gear" here would be a guess dressed as a guarantee.
  if (!hasWindow) {
    return {
      id: "gear",
      severity: "unknown",
      title: "Gear availability not checked",
      detail: "Set rental dates to check this job's gear against everything else booked.",
      actionLabel: "Set dates",
      fix: { kind: "edit" },
    };
  }
  const inWindow = windowLabel ? ` ${windowLabel}` : "";
  if (gear.hard.length > 0) {
    return {
      id: "gear",
      severity: "blocking",
      title: `Gear short for this window`,
      detail: `${gear.hard.length} ${plural(gear.hard.length, "model")} over stock${inWindow} — ${listModels(gear.hard)} short`,
      actionLabel: "Resolve",
      fix: TAB_FIX("equipment"),
    };
  }
  if (gear.pencilled.length > 0) {
    // Pencilled demand isn't a violation of today's bookings — it's what WOULD
    // collide once everything unconfirmed goes hard. Saying "is short" here
    // would cry wolf on every enquiry.
    return {
      id: "gear",
      severity: "warning",
      title: "Gear would be short if you confirm",
      detail: `Pencilled against other unconfirmed work — ${listModels(gear.pencilled)} would collide${inWindow}`,
      actionLabel: "Review",
      fix: TAB_FIX("equipment"),
    };
  }
  return { id: "gear", severity: "pass", title: "Enough gear for this window" };
}

function conflictsCheck(conflicts: ReadinessConflictInput[] | null, hasWindow: boolean): ReadinessCheck {
  // Same honesty as the gear check: no window means nothing to collide with,
  // and an unanswered detection means we don't know yet.
  if (!hasWindow) {
    return {
      id: "conflicts",
      severity: "unknown",
      title: "Double-booked assets not checked",
      detail: "Set rental dates to check serialised assets against other jobs.",
      actionLabel: "Set dates",
      fix: { kind: "edit" },
    };
  }
  if (conflicts === null) {
    return { id: "conflicts", severity: "unknown", title: "Double-booked assets not checked yet", actionLabel: "Equipment", fix: TAB_FIX("equipment") };
  }
  if (conflicts.length === 0) {
    return { id: "conflicts", severity: "pass", title: "No assets double-booked" };
  }
  const first = conflicts[0];
  const rest = conflicts.length - 1;
  return {
    id: "conflicts",
    severity: "blocking",
    title: `${conflicts.length} ${plural(conflicts.length, "asset")} double-booked`,
    detail:
      `${first.assetTag} ${first.modelName} — also on ${first.conflictingProject.projectNumber}` +
      (rest > 0 ? ` +${rest} more` : ""),
    actionLabel: "Swap",
    fix: TAB_FIX("equipment"),
  };
}

/**
 * UX Phase 7 (§6b) — an open blocking discussion holds prep and dispatch
 * (`updateStatusNative` refuses those moves), so it is a blocker here too.
 * `null` (count still loading) drops the row rather than guessing.
 */
function discussionsCheck(blockingCount: number | null | undefined): ReadinessCheck | null {
  if (blockingCount == null) return null;
  if (blockingCount === 0) return { id: "discussions", severity: "pass", title: "No blocking discussions" };
  return {
    id: "discussions",
    severity: "blocking",
    title: `${blockingCount} blocking ${plural(blockingCount, "discussion")} ${plural(blockingCount, "holds", "hold")} prep`,
    detail: "Prep and dispatch are held until it is resolved.",
    actionLabel: "Open the discussion",
    fix: { kind: "discussion" },
  };
}

/** UX Phase 7 — open incidents on this job's gear (Report Issue / a check FAIL). */
function incidentsCheck(incidents: ReadinessIncidentInput | undefined): ReadinessCheck | null {
  if (!incidents) return null;
  const n = incidents.openCount;
  if (n === 0 && !incidents.truncated) return { id: "incidents", severity: "pass", title: "No open incidents" };
  const count = incidents.truncated ? `${n}+` : String(n);
  return {
    id: "incidents",
    severity: "warning",
    title: `${count} open ${plural(n, "incident")} on this job's gear`,
    actionLabel: "Warehouse",
    fix: { kind: "warehouse" },
  };
}

/**
 * PEOPLE, not work. Whether the humans you've asked have said yes — service
 * confirmation and staffing gaps are the `services` check below, because
 * "Dave hasn't replied" and "the bump-in isn't locked in" are different
 * problems with different fixes, and cramming both into one row made it
 * unreadable at three dimensions.
 *
 * Returns `null` — the row doesn't render at all — when nobody's assigned
 * yet: there's nothing to chase, so "No crew assigned yet" was noise a job
 * with no crew requirement would carry forever.
 */
function crewCheck(crew: ReadinessCrewInput): ReadinessCheck | null {
  if (crew.activeCount === 0) return null;
  if (crew.unconfirmedCount === 0) {
    return { id: "crew", severity: "pass", title: "All crew confirmed" };
  }
  return {
    id: "crew",
    severity: "warning",
    title: `${crew.unconfirmedCount} of ${crew.activeCount} crew unconfirmed`,
    detail: `${crew.unconfirmedCount} ${plural(crew.unconfirmedCount, "person", "people")} ${plural(crew.unconfirmedCount, "hasn't", "haven't")} responded to the offer`,
    actionLabel: "Chase crew",
    fix: TAB_FIX("labour"),
  };
}

/**
 * The WORK: services nobody has confirmed, and services short of people.
 *
 * Returns `null` when the project has no services scheduled at all — same
 * reasoning as `crewCheck`: a job that doesn't need services shouldn't carry
 * a permanent "No services scheduled" row.
 */
function servicesCheck(crew: ReadinessCrewInput): ReadinessCheck | null {
  if (crew.activeServiceCount === 0) return null;
  const unconfirmed = crew.unconfirmedServices;
  const understaffed = crew.servicesMissingCrew;
  const parts: string[] = [];
  if (unconfirmed.length > 0) {
    parts.push(`not confirmed: ${unconfirmed.slice(0, 3).map((s) => s.title).join(", ")}`);
  }
  if (understaffed.length > 0) {
    parts.push(
      `${understaffed.length} short ${crew.crewShortfall} ${plural(crew.crewShortfall, "person", "people")} between ${plural(understaffed.length, "it", "them")}`,
    );
  }

  if (parts.length === 0) {
    return { id: "services", severity: "pass", title: "All services confirmed and staffed" };
  }

  const title =
    unconfirmed.length > 0
      ? `${unconfirmed.length} of ${crew.activeServiceCount} ${plural(crew.activeServiceCount, "service")} not confirmed`
      : `${understaffed.length} ${plural(understaffed.length, "service")} short of crew`;
  return { id: "services", severity: "warning", title, detail: parts.join(" · "), actionLabel: "Open services", fix: TAB_FIX("labour") };
}

function pricingCheck(pricing: ReadinessPricingInput): ReadinessCheck {
  if (pricing.unpricedCount === 0) {
    return { id: "pricing", severity: "pass", title: "Every line is priced" };
  }
  return {
    id: "pricing",
    severity: "warning",
    title: `${pricing.unpricedCount} ${plural(pricing.unpricedCount, "line item")} unpriced`,
    detail: `Added while financials were locked — ${pricing.unpriced.slice(0, 3).map((u) => u.label).join(", ")}`,
    actionLabel: "Review",
    fix: TAB_FIX("equipment"),
  };
}

/**
 * #1296 build plan phase 4 (Q8 — a non-blocking warning, never a violation
 * that would stop a job going out; return-side unpacked gear is a legitimate
 * "Loose" section on the manifest, not an error). Returns `null` when the
 * project has no plannable equipment at all — same "nothing to carry a
 * permanent row for" reasoning as `crewCheck`/`servicesCheck`.
 */
function packingCheck(packing: ReadinessPackingInput): ReadinessCheck | null {
  if (packing.totalCount === 0) return null;
  if (packing.notPlannedCount === 0) return { id: "packing", severity: "pass", title: "Every line has a container" };
  return {
    id: "packing",
    severity: "warning",
    title: `${packing.notPlannedCount} of ${packing.totalCount} ${plural(packing.totalCount, "line")} not planned`,
    detail: "No container assigned yet — plan it on the Packing tab before the warehouse starts prepping.",
    actionLabel: "Open Packing",
    fix: TAB_FIX("packing"),
  };
}

/**
 * Fixed order, worst-first within it: gear, conflicts and a blocking
 * discussion can stop a job going out, services and crew are the people side,
 * pricing and packing cost money/time but not the load-out itself, and an open
 * incident is the warehouse's to sort. The order is stable regardless of
 * severity so the panel doesn't reshuffle under the user as problems
 * resolve — only the marks change.
 *
 * `services` and `crew` can each come back `null` (nothing scheduled /
 * nobody assigned), same as `packing` (nothing to plan) — those rows are
 * dropped rather than rendered as a permanent pass, so a job that doesn't
 * need crew, services, or gear planning doesn't carry checks for facts that
 * were never true.
 */
export function buildReadinessChecks(input: BuildChecksInput): ReadinessCheck[] {
  return [
    gearCheck(input),
    conflictsCheck(input.conflicts, input.hasWindow),
    discussionsCheck(input.blockingCount),
    servicesCheck(input.crew),
    crewCheck(input.crew),
    pricingCheck(input.pricing),
    packingCheck(input.packing),
    incidentsCheck(input.incidents),
  ].filter((c): c is ReadinessCheck => c !== null);
}

export interface ReadinessSummary {
  blocking: number;
  warning: number;
  unknown: number;
  /** Every check ran and passed — the panel collapses to a single line. */
  allClear: boolean;
  total: number;
}

export function summariseReadiness(checks: ReadinessCheck[]): ReadinessSummary {
  const blocking = checks.filter((c) => c.severity === "blocking").length;
  const warning = checks.filter((c) => c.severity === "warning").length;
  const unknown = checks.filter((c) => c.severity === "unknown").length;
  return {
    blocking,
    warning,
    unknown,
    // An `unknown` is NOT an all-clear — a check that couldn't run must never
    // collapse into "ready".
    allClear: blocking === 0 && warning === 0 && unknown === 0,
    total: checks.length,
  };
}
