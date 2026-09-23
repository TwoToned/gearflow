import { addBusinessDaysInTimezone, startOfDayInTimezone } from "./quoteDates";

/**
 * Follow-up automation — the pure rule (docs/designs/follow-up-automation.md
 * §8.1–§8.3). Given one project's facts, the org's settings and `now`, this
 * decides what the ONE open follow-up for the project's quote loop should look
 * like, and which open rows must close. It never reads the database; the
 * reconciler (`followUpReconcile.ts`) loads the facts and applies the plan.
 *
 * The model, in one paragraph: every SENT quote on the live version is an open
 * loop that always has exactly one dated next step. Rung 1 is due two business
 * days after the send; each human "no reply" closes that rung and the next one
 * comes due five business days later; rung 3 is the decision ("won, lost,
 * extend or park?"). Every due date is clamped to the loop's DEADLINE — the
 * earlier of "the event minus the decision lead time" and "two days before the
 * quote expires" — so a quote for an event next week is chased daily, not on a
 * calendar written for an event in March. The loop ends when the quote is
 * accepted or declined, the project is cancelled, or the decision rung is
 * closed.
 *
 * Only `quote` is wired in phase 1. Invoices (phase 2) plug in as another rule
 * with its own `ruleKey`, never as a second writer of follow-up rows.
 */

// ─── Settings ─────────────────────────────────────────────────────────────

export interface FollowUpConfig {
  /** Quote follow-ups on/off. Absent in the stored blob = ON (same convention
   *  as the project-status automation keys: the blob only records an opt-out). */
  quotesEnabled: boolean;
  /** Business days from the send to the first follow-up. */
  firstFollowUpBusinessDays: number;
  /** Business days from a "no reply" to the next rung. */
  nextFollowUpBusinessDays: number;
  /** Calendar days before the event the job should be decided by. */
  decisionLeadDays: number;
  /** Loops whose quote was sent before this instant are never touched — the
   *  backlog guard (design §8.4). */
  cutoverAt: number;
  timezone: string | undefined;
}

export const FOLLOW_UP_DEFAULTS = {
  firstFollowUpBusinessDays: 2,
  nextFollowUpBusinessDays: 5,
  decisionLeadDays: 14,
} as const;

/** Bounds shared by the settings resolver and (later) the settings form. */
export const FOLLOW_UP_BOUNDS = {
  businessDays: { min: 1, max: 30 },
  decisionLeadDays: { min: 0, max: 90 },
} as const;

/** Cut-over for every org that hasn't stamped its own: the day phase 1 shipped
 *  (2026-09-23 00:00 AEST). Nothing sent before it is ever chased, so turning
 *  the engine on can't dump the historical backlog into anyone's list. */
export const FOLLOW_UP_DEFAULT_CUTOVER_AT = Date.UTC(2026, 8, 22, 14, 0, 0);

// ─── Row + plan shapes ────────────────────────────────────────────────────

export const FOLLOW_UP_RULE_KEYS = ["quote"] as const;
export type FollowUpRuleKey = (typeof FOLLOW_UP_RULE_KEYS)[number];

/** How an automated row was closed. `no_reply` and `deleted` consume a rung
 *  and keep the loop going; everything in TERMINAL ends the loop. `recalled`
 *  and `superseded` close the row but let a quick re-send continue the ladder. */
export const FOLLOW_UP_RESOLUTIONS = [
  "no_reply",
  "deleted",
  "accepted",
  "declined",
  "cancelled",
  "decided",
  "recalled",
  "superseded",
  "disabled",
] as const;
export type FollowUpResolution = (typeof FOLLOW_UP_RESOLUTIONS)[number];

const TERMINAL: ReadonlySet<FollowUpResolution> = new Set(["accepted", "declined", "cancelled", "decided"]);
const RUNG_CONSUMING: ReadonlySet<FollowUpResolution> = new Set(["no_reply", "deleted"]);

/** Fields a human can take over; once edited the reconciler never writes them. */
export const FOLLOW_UP_LOCKABLE_FIELDS = ["dueDate", "title", "assignee"] as const;
export type FollowUpLockableField = (typeof FOLLOW_UP_LOCKABLE_FIELDS)[number];

export const DECISION_RUNG = 3;
/** Housekeeping rung: the job went ahead (or the event started) while the
 *  quote was still out. Never a chase — just "record what happened". */
export const HOUSEKEEPING_RUNG = 0;

export interface FollowUpRow {
  id: string;
  open: boolean;
  createdAt: number;
  completedAt?: number;
  dueDate?: number;
  rung: number;
  loopStartAt: number;
  subjectId: string;
  resolution?: FollowUpResolution;
  nextDate?: number;
  lockedFields: readonly string[];
}

export interface QuoteLoopFacts {
  now: number;
  config: FollowUpConfig;
  project: {
    status: string | undefined;
    eventStart: number | undefined;
    projectNumber: string;
  };
  /** The SENT/EXPIRED quote on the live version, or the live version's latest
   *  quote in any other state (so an accept/decline can close the loop). */
  quote: {
    id: string;
    version: number;
    effectiveStatus: string;
    sentAt: number | undefined;
    validUntil: number | undefined;
  } | null;
  /** Every automated quote row for this project, open and closed. */
  rows: FollowUpRow[];
}

export interface DesiredFollowUp {
  rung: number;
  loopStartAt: number;
  subjectId: string;
  dueDate: number;
  priority: "NORMAL" | "HIGH";
  urgent: boolean;
  title: string;
  why: string;
}

export interface QuoteLoopPlan {
  /** Open rows to close, with how. */
  close: { id: string; resolution: FollowUpResolution; status: "DONE" | "CANCELLED" }[];
  /** What the single open row should be; `existingId` when one is kept. */
  desired: (DesiredFollowUp & { existingId?: string }) | null;
}

const PRE_CONFIRM = new Set(["ENQUIRY", "QUOTING", "QUOTED"]);
const DAY_MS = 86_400_000;
const URGENT_WINDOW_MS = 7 * DAY_MS;

// ─── The rule ─────────────────────────────────────────────────────────────

export function quoteLabelFor(projectNumber: string, version: number): string {
  return `${projectNumber} v${version}`;
}

function formatShortDate(ms: number, timezone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: timezone || "UTC" }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ms));
  }
}

/** The loop's deadline: the earlier of (event start − lead days) and
 *  (validUntil − 2 days). Undefined when neither date exists. */
export function loopDeadline(facts: Pick<QuoteLoopFacts, "config" | "project" | "quote">): number | undefined {
  const candidates: number[] = [];
  if (facts.project.eventStart != null) {
    candidates.push(facts.project.eventStart - facts.config.decisionLeadDays * DAY_MS);
  }
  if (facts.quote?.validUntil != null) candidates.push(facts.quote.validUntil - 2 * DAY_MS);
  return candidates.length ? Math.min(...candidates) : undefined;
}

function closeAll(rows: FollowUpRow[], resolution: FollowUpResolution, status: "DONE" | "CANCELLED"): QuoteLoopPlan["close"] {
  return rows.filter((r) => r.open).map((r) => ({ id: r.id, resolution, status }));
}

/** Rows belonging to the loop that is (or would be) running now: the ones
 *  after the last terminal close, sharing the newest `loopStartAt`. */
function currentLoopRows(rows: FollowUpRow[]): FollowUpRow[] {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  let lastTerminal = -1;
  sorted.forEach((r, i) => {
    if (!r.open && r.resolution && TERMINAL.has(r.resolution)) lastTerminal = i;
  });
  const after = sorted.slice(lastTerminal + 1);
  if (!after.length) return [];
  const newestStart = Math.max(...after.map((r) => r.loopStartAt));
  return after.filter((r) => r.loopStartAt === newestStart);
}

export function planQuoteLoop(facts: QuoteLoopFacts): QuoteLoopPlan {
  const { now, config, project, quote } = facts;
  const tz = config.timezone;
  const openRows = facts.rows.filter((r) => r.open);

  // ── Loops that end, or never start ──────────────────────────────────────
  if (project.status === "CANCELLED") return { close: closeAll(openRows, "cancelled", "CANCELLED"), desired: null };
  if (!quote) return { close: closeAll(openRows, "recalled", "CANCELLED"), desired: null };
  if (quote.effectiveStatus === "ACCEPTED") return { close: closeAll(openRows, "accepted", "DONE"), desired: null };
  if (quote.effectiveStatus === "DECLINED") return { close: closeAll(openRows, "declined", "DONE"), desired: null };
  if (quote.effectiveStatus !== "SENT" && quote.effectiveStatus !== "EXPIRED") {
    return { close: closeAll(openRows, "recalled", "CANCELLED"), desired: null };
  }
  if (quote.sentAt == null || quote.sentAt < config.cutoverAt) return { close: [], desired: null };
  if (!config.quotesEnabled) return { close: closeAll(openRows, "disabled", "CANCELLED"), desired: null };

  // ── Which loop are we in? ───────────────────────────────────────────────
  // A loop someone already ended (decided / housekeeping recorded) stays ended
  // for this send — only a send AFTER that close starts a new conversation.
  const lastTerminalAt = Math.max(
    0,
    ...facts.rows.filter((r) => !r.open && r.resolution && TERMINAL.has(r.resolution)).map((r) => r.completedAt ?? r.createdAt),
  );
  if (lastTerminalAt > 0 && quote.sentAt <= lastTerminalAt) {
    return { close: closeAll(openRows, "superseded", "CANCELLED"), desired: null };
  }
  let loop = currentLoopRows(facts.rows);
  const close: QuoteLoopPlan["close"] = [];
  if (loop.length) {
    const lastActivity = Math.max(...loop.map((r) => Math.max(r.loopStartAt, r.completedAt ?? 0)));
    // A re-send (new version, or recall → re-send) well after the loop's last
    // activity is a new conversation: start again at rung 1. A quick re-send
    // continues the ladder — six resends must not mean six fresh grace periods.
    if (quote.sentAt >= addBusinessDaysInTimezone(lastActivity, config.nextFollowUpBusinessDays, tz)) {
      for (const r of loop.filter((x) => x.open)) close.push({ id: r.id, resolution: "superseded", status: "CANCELLED" });
      loop = [];
    }
  }
  const loopStartAt = loop.length ? loop[0].loopStartAt : quote.sentAt;
  const open = loop.find((r) => r.open);
  // Stray extra open rows (should never happen) are closed, never duplicated.
  for (const r of openRows) {
    if (r.id !== open?.id && !close.some((c) => c.id === r.id)) close.push({ id: r.id, resolution: "superseded", status: "CANCELLED" });
  }

  const closedInLoop = loop.filter((r) => !r.open).sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  if (closedInLoop.some((r) => r.resolution === "decided")) return { close, desired: null };
  const consumed = closedInLoop.filter((r) => r.resolution && RUNG_CONSUMING.has(r.resolution));
  const last = closedInLoop[closedInLoop.length - 1];

  const label = quoteLabelFor(project.projectNumber, quote.version);
  const sentOn = formatShortDate(quote.sentAt, tz);
  const deadline = loopDeadline(facts);
  const eventStarted = project.eventStart != null && project.eventStart <= now;

  // ── Housekeeping: the job moved on without the quote being settled ─────
  if (!PRE_CONFIRM.has(project.status ?? "") || eventStarted) {
    if (closedInLoop.some((r) => r.rung === HOUSEKEEPING_RUNG)) return { close, desired: null };
    return {
      close,
      desired: {
        existingId: open?.id,
        rung: HOUSEKEEPING_RUNG,
        loopStartAt,
        subjectId: quote.id,
        dueDate: startOfDayInTimezone(now, tz),
        priority: "NORMAL",
        urgent: false,
        title: `Record the outcome of quote ${label}`,
        why: eventStarted
          ? `The job has started but ${label} is still marked as sent.`
          : `The job has moved on but ${label} is still marked as sent.`,
      },
    };
  }

  // ── The ladder ──────────────────────────────────────────────────────────
  const expiredOrClose = quote.effectiveStatus === "EXPIRED" || (quote.validUntil != null && now >= quote.validUntil - 2 * DAY_MS);
  let rung = Math.min(consumed.length + 1, DECISION_RUNG + 1);
  if (expiredOrClose) rung = Math.max(rung, DECISION_RUNG);
  // Deleting the decision rung ends the chase — nothing comes after it.
  if (rung > DECISION_RUNG) return { close, desired: null };

  const anchor = last?.completedAt ?? loopStartAt;
  const urgent = deadline != null && deadline - now < URGENT_WINDOW_MS;
  let dueDate: number;
  if (last?.nextDate != null) {
    dueDate = startOfDayInTimezone(last.nextDate, tz);
  } else {
    const gap = urgent ? 1 : rung === 1 ? config.firstFollowUpBusinessDays : config.nextFollowUpBusinessDays;
    dueDate = addBusinessDaysInTimezone(anchor, gap, tz);
    if (deadline != null) dueDate = Math.min(dueDate, startOfDayInTimezone(deadline, tz));
    if (quote.effectiveStatus === "EXPIRED") dueDate = Math.min(dueDate, startOfDayInTimezone(now, tz));
  }

  const title =
    quote.effectiveStatus === "EXPIRED"
      ? `Quote ${label} expired — won, lost, re-send or park?`
      : rung === DECISION_RUNG
        ? `Decide on quote ${label}: won, lost, extend or park?`
        : rung === 2
          ? `Second follow-up on quote ${label}`
          : `Follow up on quote ${label}`;
  const touches = consumed.length === 0 ? "no reply logged" : `${consumed.length} follow-up${consumed.length === 1 ? "" : "s"}, no reply`;
  const eventNote = project.eventStart != null && urgent ? ` · event ${formatShortDate(project.eventStart, tz)}` : "";

  return {
    close,
    desired: {
      existingId: open?.id,
      rung,
      loopStartAt,
      subjectId: quote.id,
      dueDate,
      priority: urgent || rung === DECISION_RUNG ? "HIGH" : "NORMAL",
      urgent,
      title,
      why: `${label} sent ${sentOn} · ${touches}${eventNote}.`,
    },
  };
}

/** How a HUMAN closing an automated row should be recorded: a plain "done" on
 *  a chasing rung means "I followed up, no answer yet" (advance the ladder); on
 *  the decision or housekeeping rung it means "decided" (end the loop). */
export function resolutionForHumanDone(rung: number): FollowUpResolution {
  return rung === DECISION_RUNG || rung === HOUSEKEEPING_RUNG ? "decided" : "no_reply";
}
