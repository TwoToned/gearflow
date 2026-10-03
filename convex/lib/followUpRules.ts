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
  /** Invoice chasing + "invoice not raised" on/off (phase 2). Absent = ON. */
  invoicesEnabled: boolean;
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

export const FOLLOW_UP_RULE_KEYS = ["quote", "invoice", "invoice_unraised"] as const;
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
  "paid",
  "voided",
  "invoiced",
] as const;
export type FollowUpResolution = (typeof FOLLOW_UP_RESOLUTIONS)[number];

export const TERMINAL: ReadonlySet<FollowUpResolution> = new Set(["accepted", "declined", "cancelled", "decided", "paid", "voided", "invoiced"]);
export const RUNG_CONSUMING: ReadonlySet<FollowUpResolution> = new Set(["no_reply", "deleted"]);

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

export function formatShortDate(ms: number, timezone: string | undefined): string {
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

export function closeAll(rows: FollowUpRow[], resolution: FollowUpResolution, status: "DONE" | "CANCELLED"): QuoteLoopPlan["close"] {
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

type LiveQuote = NonNullable<QuoteLoopFacts["quote"]> & { sentAt: number };
type Close = QuoteLoopPlan["close"];
const NONE: QuoteLoopPlan = { close: [], desired: null };

/** Why a loop ends, or never starts, before any ladder maths. Null = it runs. */
const ENDING_BY_QUOTE_STATUS: Record<string, [FollowUpResolution, "DONE" | "CANCELLED"]> = {
  ACCEPTED: ["accepted", "DONE"],
  DECLINED: ["declined", "DONE"],
};

function endedPlan(facts: QuoteLoopFacts, openRows: FollowUpRow[]): QuoteLoopPlan | null {
  const { project, quote, config } = facts;
  if (project.status === "CANCELLED") return { close: closeAll(openRows, "cancelled", "CANCELLED"), desired: null };
  if (!quote) return { close: closeAll(openRows, "recalled", "CANCELLED"), desired: null };
  const ending = ENDING_BY_QUOTE_STATUS[quote.effectiveStatus];
  if (ending) return { close: closeAll(openRows, ending[0], ending[1]), desired: null };
  if (quote.effectiveStatus !== "SENT" && quote.effectiveStatus !== "EXPIRED") {
    return { close: closeAll(openRows, "recalled", "CANCELLED"), desired: null };
  }
  if (quote.sentAt == null || quote.sentAt < config.cutoverAt) return NONE;
  if (!config.quotesEnabled) return { close: closeAll(openRows, "disabled", "CANCELLED"), desired: null };
  return null;
}

function lastTerminalCloseAt(rows: FollowUpRow[]): number {
  const times = rows
    .filter((r) => !r.open && r.resolution !== undefined && TERMINAL.has(r.resolution))
    .map((r) => r.completedAt ?? r.createdAt);
  return Math.max(0, ...times);
}

/** The loop's rows after re-send handling: a re-send well after the loop's
 *  last activity is a new conversation (rung 1 again); a quick one continues
 *  the ladder — six resends must not mean six fresh grace periods. */
function resolveLoop(facts: QuoteLoopFacts, quote: LiveQuote): { loop: FollowUpRow[]; close: Close } {
  const loop = currentLoopRows(facts.rows);
  if (!loop.length) return { loop, close: [] };
  const lastActivity = Math.max(...loop.map((r) => Math.max(r.loopStartAt, r.completedAt ?? 0)));
  const restartAt = addBusinessDaysInTimezone(lastActivity, facts.config.nextFollowUpBusinessDays, facts.config.timezone);
  if (quote.sentAt < restartAt) return { loop, close: [] };
  const close: Close = loop.filter((r) => r.open).map((r) => ({ id: r.id, resolution: "superseded", status: "CANCELLED" }));
  return { loop: [], close };
}

/** Stray extra open rows (should never happen) are closed, never duplicated. */
function closeStrays(openRows: FollowUpRow[], keepId: string | undefined, close: Close): Close {
  const already = new Set(close.map((c) => c.id));
  const strays: Close = openRows
    .filter((r) => r.id !== keepId && !already.has(r.id))
    .map((r) => ({ id: r.id, resolution: "superseded", status: "CANCELLED" }));
  return [...close, ...strays];
}

function isJobPastQuoting(facts: QuoteLoopFacts): { past: boolean; eventStarted: boolean } {
  const start = facts.project.eventStart;
  const eventStarted = start !== undefined && start <= facts.now;
  return { past: eventStarted || !PRE_CONFIRM.has(facts.project.status ?? ""), eventStarted };
}

function housekeeping(facts: QuoteLoopFacts, quote: LiveQuote, ctx: LoopCtx, eventStarted: boolean): DesiredFollowUp | null {
  if (ctx.closed.some((r) => r.rung === HOUSEKEEPING_RUNG)) return null;
  const label = quoteLabelFor(facts.project.projectNumber, quote.version);
  const moved = eventStarted ? "The job has started" : "The job has moved on";
  return {
    rung: HOUSEKEEPING_RUNG,
    loopStartAt: ctx.loopStartAt,
    subjectId: quote.id,
    dueDate: startOfDayInTimezone(facts.now, facts.config.timezone),
    priority: "NORMAL",
    urgent: false,
    title: `Record the outcome of quote ${label}`,
    why: `${moved} but ${label} is still marked as sent.`,
  };
}

interface LoopCtx {
  loopStartAt: number;
  closed: FollowUpRow[];
  consumed: number;
  last: FollowUpRow | undefined;
}

function nextRung(facts: QuoteLoopFacts, quote: LiveQuote, consumed: number): number {
  const nearExpiry = quote.validUntil !== undefined && facts.now >= quote.validUntil - 2 * DAY_MS;
  const rung = Math.min(consumed + 1, DECISION_RUNG + 1);
  return quote.effectiveStatus === "EXPIRED" || nearExpiry ? Math.max(rung, DECISION_RUNG) : rung;
}

function ladderDueDate(facts: QuoteLoopFacts, quote: LiveQuote, ctx: LoopCtx, rung: number, urgent: boolean): number {
  const tz = facts.config.timezone;
  if (ctx.last?.nextDate !== undefined) return startOfDayInTimezone(ctx.last.nextDate, tz);
  const anchor = ctx.last?.completedAt ?? ctx.loopStartAt;
  const gap = urgent ? 1 : rung === 1 ? facts.config.firstFollowUpBusinessDays : facts.config.nextFollowUpBusinessDays;
  const caps = [addBusinessDaysInTimezone(anchor, gap, tz)];
  const deadline = loopDeadline(facts);
  if (deadline !== undefined) caps.push(startOfDayInTimezone(deadline, tz));
  if (quote.effectiveStatus === "EXPIRED") caps.push(startOfDayInTimezone(facts.now, tz));
  return Math.min(...caps);
}

function ladderTitle(label: string, rung: number, expired: boolean): string {
  if (expired) return `Quote ${label} expired — won, lost, re-send or park?`;
  if (rung === DECISION_RUNG) return `Decide on quote ${label}: won, lost, extend or park?`;
  return rung === 2 ? `Second follow-up on quote ${label}` : `Follow up on quote ${label}`;
}

function ladderWhy(facts: QuoteLoopFacts, quote: LiveQuote, consumed: number, urgent: boolean): string {
  const tz = facts.config.timezone;
  const label = quoteLabelFor(facts.project.projectNumber, quote.version);
  const plural = consumed === 1 ? "" : "s";
  const touches = consumed === 0 ? "no reply logged" : `${consumed} follow-up${plural}, no reply`;
  const start = facts.project.eventStart;
  const eventNote = urgent && start !== undefined ? ` · event ${formatShortDate(start, tz)}` : "";
  return `${label} sent ${formatShortDate(quote.sentAt, tz)} · ${touches}${eventNote}.`;
}

function ladder(facts: QuoteLoopFacts, quote: LiveQuote, ctx: LoopCtx): DesiredFollowUp | null {
  const rung = nextRung(facts, quote, ctx.consumed);
  // Deleting the decision rung ends the chase — nothing comes after it.
  if (rung > DECISION_RUNG) return null;
  const deadline = loopDeadline(facts);
  const urgent = deadline !== undefined && deadline - facts.now < URGENT_WINDOW_MS;
  const label = quoteLabelFor(facts.project.projectNumber, quote.version);
  return {
    rung,
    loopStartAt: ctx.loopStartAt,
    subjectId: quote.id,
    dueDate: ladderDueDate(facts, quote, ctx, rung, urgent),
    priority: urgent || rung === DECISION_RUNG ? "HIGH" : "NORMAL",
    urgent,
    title: ladderTitle(label, rung, quote.effectiveStatus === "EXPIRED"),
    why: ladderWhy(facts, quote, ctx.consumed, urgent),
  };
}

function loopContext(loop: FollowUpRow[], quote: LiveQuote): LoopCtx {
  const closed = loop.filter((r) => !r.open).sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  return {
    loopStartAt: loop.length ? loop[0].loopStartAt : quote.sentAt,
    closed,
    consumed: closed.filter((r) => r.resolution !== undefined && RUNG_CONSUMING.has(r.resolution)).length,
    last: closed[closed.length - 1],
  };
}

export function planQuoteLoop(facts: QuoteLoopFacts): QuoteLoopPlan {
  const openRows = facts.rows.filter((r) => r.open);
  const ended = endedPlan(facts, openRows);
  if (ended) return ended;
  const quote = facts.quote as LiveQuote; // endedPlan guarantees a sent quote

  // A loop someone already ended (decided / housekeeping recorded) stays ended
  // for this send — only a send AFTER that close starts a new conversation.
  const terminalAt = lastTerminalCloseAt(facts.rows);
  if (terminalAt > 0 && quote.sentAt <= terminalAt) return { close: closeAll(openRows, "superseded", "CANCELLED"), desired: null };

  const resolved = resolveLoop(facts, quote);
  const open = resolved.loop.find((r) => r.open);
  const close = closeStrays(openRows, open?.id, resolved.close);
  const ctx = loopContext(resolved.loop, quote);
  if (ctx.closed.some((r) => r.resolution === "decided")) return { close, desired: null };

  const { past, eventStarted } = isJobPastQuoting(facts);
  const desired = past ? housekeeping(facts, quote, ctx, eventStarted) : ladder(facts, quote, ctx);
  return { close, desired: desired ? { ...desired, existingId: open?.id } : null };
}

/** How a HUMAN closing an automated row should be recorded: a plain "done" on
 *  a chasing rung means "I followed up, no answer yet" (advance the ladder); on
 *  the loop's decision (or housekeeping) rung it means "decided" (end it). The
 *  invoice chase decides at rung 4; "invoice not raised" is one item, so any
 *  done ends it. */
export function resolutionForHumanDone(rung: number, ruleKey: FollowUpRuleKey = "quote"): FollowUpResolution {
  if (ruleKey === "invoice_unraised") return "decided";
  const decision = ruleKey === "invoice" ? 4 : DECISION_RUNG;
  return rung >= decision || rung === HOUSEKEEPING_RUNG ? "decided" : "no_reply";
}
