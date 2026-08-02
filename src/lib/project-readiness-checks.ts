/**
 * Turns the three readiness data sources into the ordered list of checks the
 * Overview tab's Readiness panel renders (#1061).
 *
 * A plain module, not a hook and not inside a `"use server"` file, so the
 * wording and severity rules are unit-testable without React or Convex — the
 * severity of a check decides whether the panel shouts or whispers, which is
 * exactly the kind of rule that rots silently if it only exists inside JSX.
 *
 * Two sources feed in, deliberately kept separate (R-3.1 — each rule has
 * exactly one home):
 *   - `projectReadiness.forProject`         → gear, crew, unpriced
 *   - `reservationConflicts.projectConflicts` → double-booked assets
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
export type ReadinessSeverity = "blocking" | "warning" | "pass" | "unknown";

export type ReadinessCheckId = "gear" | "conflicts" | "crew" | "services" | "pricing";

export interface ReadinessCheck {
  id: ReadinessCheckId;
  severity: ReadinessSeverity;
  /** One line, stating the finding — never a bare label like "Gear". */
  title: string;
  /** The specifics: which models, which assets, how many. */
  detail?: string;
  /** Label for the row's inline action; absent on a passing/unknown row. */
  actionLabel?: string;
}

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

export interface ReadinessConflictInput {
  assetTag: string;
  modelName: string;
  conflictingProject: { projectNumber: string };
}

export interface BuildChecksInput {
  hasWindow: boolean;
  /** Preformatted rental window, e.g. "12 – 16 Aug" — omitted when dateless. */
  windowLabel?: string;
  gear: ReadinessGearInput;
  crew: ReadinessCrewInput;
  pricing: ReadinessPricingInput;
  conflicts: ReadinessConflictInput[];
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
      detail: "Set rental dates to check this project's gear against everything else booked.",
      actionLabel: "Set dates",
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
    };
  }
  return { id: "gear", severity: "pass", title: "Enough gear for this window" };
}

function conflictsCheck(conflicts: ReadinessConflictInput[]): ReadinessCheck {
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
  return { id: "services", severity: "warning", title, detail: parts.join(" · "), actionLabel: "Open services" };
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
  };
}

/**
 * Fixed order, worst-first within it: gear and conflicts can stop a job going
 * out, services and crew are the people side, pricing costs money but not the
 * load-out. The order is stable regardless of severity so the panel doesn't
 * reshuffle under the user as problems resolve — only the marks change.
 *
 * `services` and `crew` can each come back `null` (nothing scheduled /
 * nobody assigned) — those rows are dropped rather than rendered as a
 * permanent pass, so a job that doesn't need crew or services doesn't carry
 * checks for facts that were never true.
 */
export function buildReadinessChecks(input: BuildChecksInput): ReadinessCheck[] {
  return [
    gearCheck(input),
    conflictsCheck(input.conflicts),
    servicesCheck(input.crew),
    crewCheck(input.crew),
    pricingCheck(input.pricing),
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
