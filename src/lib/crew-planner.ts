/**
 * The crew planner's derived facts (UX Phase 15, spec §9h.3). Pure: no React,
 * no router. The grid, the Needs crew list, the strip, the footer and the
 * Offer a call sheet all read these, so a count, a status word or an
 * availability word has ONE definition.
 *
 * Days are `YYYY-MM-DD` keys in UTC: assignments, services and availability
 * blocks are stored at UTC midnight of their day (`dayKeyOf` in the job's
 * Logistics tab writes them that way). Only "today" is the viewer's local day.
 */
import { assignmentStatusLabels } from "@/lib/status-labels";
import { getStatusIntent, type ColorIntent } from "@/lib/status-colors";

const DAY_MS = 86_400_000;

// ─── Wire shapes (crewAvailability.plannerData, crewPlanner.openCalls) ──────

export interface PlannerCall {
  id: string;
  status?: string | null;
  serviceId?: string | null;
  crewRoleId?: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  estimatedHours?: number | null;
  offeredAt?: string | null;
  project: { id: string; name: string; projectNumber: string; status?: string | null; projectManagerId?: string | null } | null;
  crewRole: { name: string; color?: string | null } | null;
}

interface PlannerAvailability {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export interface PlannerMember {
  id: string;
  firstName: string;
  lastName: string;
  department: string | null;
  crewRole: { id: string; name: string; color?: string | null } | null;
  skillIds: string[];
  assignments: PlannerCall[];
  availability: PlannerAvailability[];
}

export interface OpenCall {
  serviceId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  title: string;
  date: number | null;
  endDate?: number | null;
  shortfall: number;
  startTime: string | null;
  endTime: string | null;
  crewRoleId: string | null;
  crewRoleName: string | null;
  phase: string;
}

// ─── Days ────────────────────────────────────────────────────────────────────

export const keyOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const keyOfIso = (iso: string): string => iso.slice(0, 10);
const msOfKey =(key: string): number => Date.parse(`${key}T00:00:00.000Z`);
export const addDays = (key: string, n: number): string => keyOfMs(msOfKey(key) + n * DAY_MS);

/** The org's first day of the week (#1086, `useOrgWeekStartsOn`): 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

const dayOfWeek = (key: string): number => new Date(msOfKey(key)).getUTCDay();
export const isWeekend = (key: string): boolean => dayOfWeek(key) === 0 || dayOfWeek(key) === 6;
/** The first day of the week `key` falls in, by the org's week start (D46 fixes ONE week, not Monday). */
export const weekOf = (key: string, startsOn: WeekStart = 1): string => addDays(key, -((dayOfWeek(key) - startsOn + 7) % 7));
export const weekDays = (week: string): string[] => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week, i));

/** The viewer's local calendar day as a key. */
export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The week the planner opens on: this week, or the next working week on a weekend (§9h.3). */
export function defaultWeek(todayKey: string, startsOn: WeekStart = 1): string {
  // +2 from Sat/Sun lands on Mon/Tue: its week holds the next working days for either start.
  return weekOf(isWeekend(todayKey) ? addDays(todayKey, 2) : todayKey, startsOn);
}

/** A key as a local-noon Date, for the `Intl` display formatters (never off by a day). */
export function displayDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The query window for a week: its first day 00:00 UTC to its seventh day 23:59:59.999 UTC. */
export function weekRange(week: string): { startMs: number; endMs: number } {
  const startMs = msOfKey(week);
  return { startMs, endMs: startMs + 7 * DAY_MS - 1 };
}

// ─── Calls ───────────────────────────────────────────────────────────────────

const status = (c: { status?: string | null }): string => c.status ?? "PENDING";
/** A call that still holds the person's day (DECLINED is the person's no; CANCELLED is never sent). */
const isActiveCall =(c: PlannerCall): boolean => status(c) !== "DECLINED" && status(c) !== "CANCELLED";
const UNCONFIRMED = new Set(["PENDING", "OFFERED", "ACCEPTED"]);
const isUnconfirmed =(c: PlannerCall): boolean => UNCONFIRMED.has(status(c));
/** Mine = the Jobs list's `My jobs` rule: calls on jobs I am the project manager of. */
const isMine =(c: PlannerCall, userId: string | undefined): boolean => !!userId && c.project?.projectManagerId === userId;

function callCovers(c: PlannerCall, day: string): boolean {
  if (!c.startDate) return false;
  const from = keyOfIso(c.startDate);
  const to = c.endDate ? keyOfIso(c.endDate) : from;
  return from <= day && day <= to;
}

/** The person's calls on `day`, earliest first. */
export function callsOn(m: PlannerMember, day: string): PlannerCall[] {
  return m.assignments.filter((c) => callCovers(c, day)).sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** Every distinct call with a day in the week (the grid can only place dated calls). */
function weekCalls(members: PlannerMember[], week: string): PlannerCall[] {
  const days = weekDays(week);
  const seen = new Map<string, PlannerCall>();
  for (const m of members) for (const c of m.assignments) if (days.some((d) => callCovers(c, d))) seen.set(c.id, c);
  return [...seen.values()];
}

/** `#2341 Rigger` → the role the call is for, falling back to the person's own. */
export const callRoleName = (c: PlannerCall, m?: PlannerMember): string => c.crewRole?.name ?? m?.crewRole?.name ?? "";
export const callTimes = (c: { startTime?: string | null; endTime?: string | null }): string =>
  c.startTime || c.endTime ? `${c.startTime ?? "—"}–${c.endTime ?? "—"}` : "";

export interface CallStatusWord {
  label: string;
  intent: ColorIntent;
  /** Days since the offer went out (`2d`), only while Offered. */
  age?: string;
  /** Amber from 3 days. */
  stale?: boolean;
}

/** `● Offered 2d`: the word from the ONE assignment label source, intent from status-colors. */
export function callStatusWord(c: PlannerCall, nowMs: number): CallStatusWord {
  const s = status(c);
  const word: CallStatusWord = { label: assignmentStatusLabels[s] ?? s, intent: getStatusIntent("assignment", s) };
  if (s !== "OFFERED" || !c.offeredAt) return word;
  const days = Math.floor((nowMs - Date.parse(c.offeredAt)) / DAY_MS);
  return days > 0 ? { ...word, age: `${days}d`, stale: days >= 3 } : word;
}

// ─── Availability ────────────────────────────────────────────────────────────

export type DayKind = "unavailable" | "booked" | "pencilled" | "preferred" | "free";

export interface DayState {
  kind: DayKind;
  /** `Unavailable · Leave`, `Pencilled · #2340 Launch night`, `On #2341 · 08:00–18:00`, `Free`. */
  text: string;
  /** The block's reason (`Leave`, `#2340 Launch night`), printed under the word in a cell. */
  ref?: string;
}

function blockOn(m: PlannerMember, day: string, type: string): PlannerAvailability | undefined {
  return m.availability.find((a) => a.type === type && keyOfIso(a.startDate) <= day && day <= keyOfIso(a.endDate));
}

const withRef = (word: string, ref: string | null | undefined): string => (ref ? `${word} · ${ref}` : word);

/**
 * What a person's day is (§9h.3). Unavailable wins, then a booked call (other
 * than `exceptCallId`), then a TENTATIVE block (Pencilled, Q-S5), then
 * Preferred. Marks are advisory: an offer into any of them is still allowed.
 */
export function dayState(m: PlannerMember, day: string, exceptCallId?: string): DayState {
  const off = blockOn(m, day, "UNAVAILABLE");
  if (off) return { kind: "unavailable", text: withRef("Unavailable", off.reason), ref: off.reason ?? undefined };
  const booked = m.assignments.find((c) => c.id !== exceptCallId && isActiveCall(c) && callCovers(c, day));
  if (booked) return { kind: "booked", text: `On ${booked.project?.projectNumber ?? "a job"}${callTimes(booked) ? ` · ${callTimes(booked)}` : ""}` };
  const pencil = blockOn(m, day, "TENTATIVE");
  if (pencil) return { kind: "pencilled", text: withRef("Pencilled", pencil.reason), ref: pencil.reason ?? undefined };
  if (blockOn(m, day, "PREFERRED")) return { kind: "preferred", text: "Preferred this day" };
  return { kind: "free", text: "Free" };
}

export const DAY_KIND_INTENT: Record<DayKind, ColorIntent> = {
  unavailable: "error",
  booked: "warning",
  pencilled: "warning",
  preferred: "success",
  free: "success",
};

// ─── Hours (planned / logged, derived) ───────────────────────────────────────

/** Not committed work: the person said no, or the call was never offered (the live rule). */
const NOT_PLANNED = new Set(["PENDING", "DECLINED", "CANCELLED"]);

function spanHours(c: PlannerCall): number {
  if (!c.startTime || !c.endTime) return 0;
  const [sh, sm] = c.startTime.split(":").map(Number);
  const [eh, em] = c.endTime.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 1440; // an overnight call (23:30–02:30)
  return mins / 60;
}

/** Planned hours this week: each call's own estimate, else its times × its days in the week. */
export function plannedHours(m: PlannerMember, week: string): number {
  const days = weekDays(week);
  let total = 0;
  for (const c of m.assignments) {
    if (NOT_PLANNED.has(status(c))) continue;
    const inWeek = days.filter((d) => callCovers(c, d)).length;
    if (inWeek === 0) continue;
    total += typeof c.estimatedHours === "number" ? c.estimatedHours : spanHours(c) * inWeek;
  }
  return total;
}

export const hoursText = (h: number): string => `${Math.round(h * 10) / 10}h`;

// ─── Strip, filters, dimming ─────────────────────────────────────────────────

type PlannerSegment = "all" | "needs" | "unconfirmed" | "mine";

export const AVAIL_KEYS = ["free", "booked", "unavailable", "pencilled", "preferred"] as const;
export type AvailKey = (typeof AVAIL_KEYS)[number];

export interface PlannerFilters {
  seg: string;
  q: string;
  role: string[];
  skill: string[];
  job: string[];
  avail: AvailKey[];
}

export function stripCounts(members: PlannerMember[], open: OpenCall[], week: string, userId: string | undefined): Record<PlannerSegment, number> {
  const calls = weekCalls(members, week);
  const active = calls.filter(isActiveCall);
  return {
    all: calls.length,
    needs: open.reduce((n, o) => n + o.shortfall, 0),
    unconfirmed: active.filter(isUnconfirmed).length,
    mine: active.filter((c) => isMine(c, userId)).length,
  };
}

/** Does this call match the Unconfirmed / Mine segment? (All and Needs crew match every call.) */
function segMatches(c: PlannerCall, seg: string, userId: string | undefined): boolean {
  if (seg === "unconfirmed") return isUnconfirmed(c);
  if (seg === "mine") return isMine(c, userId);
  return true;
}

const narrowsPeople = (seg: string): boolean => seg === "unconfirmed" || seg === "mine";

function memberCallsInWeek(m: PlannerMember, week: string): PlannerCall[] {
  const days = weekDays(week);
  return m.assignments.filter((c) => days.some((d) => callCovers(c, d)));
}

function availMatches(m: PlannerMember, week: string, want: AvailKey): boolean {
  const days = weekDays(week);
  const kinds = days.map((d) => dayState(m, d).kind);
  if (want === "free") return !memberCallsInWeek(m, week).some(isActiveCall) && !kinds.includes("unavailable");
  return kinds.includes(want);
}

function searchHay(m: PlannerMember, calls: PlannerCall[], skillName: (id: string) => string): string {
  return [
    m.firstName, m.lastName, m.crewRole?.name, m.department,
    ...m.skillIds.map(skillName),
    ...calls.map((c) => `${c.project?.projectNumber ?? ""} ${c.project?.name ?? ""}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

/** The person-level filters: Role, Skill, Job, Availability, search, and the Unconfirmed / Mine segments. */
export function memberMatches(m: PlannerMember, f: PlannerFilters, ctx: { week: string; userId?: string; skillName: (id: string) => string }): boolean {
  const calls = memberCallsInWeek(m, ctx.week);
  const checks: (() => boolean)[] = [
    () => f.role.length === 0 || (!!m.crewRole && f.role.includes(m.crewRole.id)),
    () => f.skill.length === 0 || m.skillIds.some((s) => f.skill.includes(s)),
    () => f.job.length === 0 || calls.some((c) => !!c.project && f.job.includes(c.project.id)),
    () => f.avail.length === 0 || f.avail.some((a) => availMatches(m, ctx.week, a)),
    () => !f.q.trim() || searchHay(m, calls, ctx.skillName).includes(f.q.trim().toLowerCase()),
    () => !narrowsPeople(f.seg) || calls.some((c) => isActiveCall(c) && segMatches(c, f.seg, ctx.userId)),
  ];
  return checks.every((check) => check());
}

/** A block is dimmed when a Job filter or the Unconfirmed / Mine segment is about other calls. */
export function isDimmed(c: PlannerCall, f: PlannerFilters, userId: string | undefined): boolean {
  if (f.job.length > 0 && !(c.project && f.job.includes(c.project.id))) return true;
  return narrowsPeople(f.seg) && !segMatches(c, f.seg, userId);
}

/** Needs crew rows the Role / Job filters and search keep. */
export function openCallMatches(o: OpenCall, f: PlannerFilters): boolean {
  if (f.role.length > 0 && !(o.crewRoleId && f.role.includes(o.crewRoleId))) return false;
  if (f.job.length > 0 && !f.job.includes(o.projectId)) return false;
  const q = f.q.trim().toLowerCase();
  return !q || `${o.projectNumber} ${o.projectName} ${o.title} ${o.crewRoleName ?? ""}`.toLowerCase().includes(q);
}

/** People by last name (the planner's row order). */
export const byLastName = (a: PlannerMember, b: PlannerMember): number =>
  a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

export const memberName = (m: { firstName: string; lastName: string }): string => `${m.firstName} ${m.lastName}`.trim();

// ─── Footer ──────────────────────────────────────────────────────────────────

/** `10 people · 5 of 13 confirmed · 2 accepted · 2 offered · 4 pending`, plus the declined flag (§9h.2). */
export function plannerFooter(members: PlannerMember[], week: string): { text: string; declined: number } {
  const calls = weekCalls(members, week);
  const n = (s: string) => calls.filter((c) => status(c) === s).length;
  const active = calls.filter(isActiveCall).length;
  const confirmed = n("CONFIRMED") + n("COMPLETED");
  const people = `${members.length} ${members.length === 1 ? "person" : "people"}`;
  return {
    text: `${people} · ${confirmed} of ${active} confirmed · ${n("ACCEPTED")} accepted · ${n("OFFERED")} offered · ${n("PENDING")} pending`,
    declined: n("DECLINED"),
  };
}

// ─── Suggestions (Offer to suggested, the Needs crew avatars) ────────────────

const SUGGEST_RANK: Partial<Record<DayKind, number>> = { preferred: 0, free: 1, pencilled: 2 };

/** Does the service (a single day, or a `[date, endDate]` run) cover `day`? */
export function coversDay(o: Pick<OpenCall, "date" | "endDate">, day: string): boolean {
  if (o.date == null) return false;
  const from = keyOfMs(o.date);
  const to = o.endDate != null ? keyOfMs(o.endDate) : from;
  return from <= day && day <= to;
}

/** The days of `window` the service covers (a multi-day run may start before it). */
export function daysCovered(o: Pick<OpenCall, "date" | "endDate">, window: readonly string[]): string[] {
  return window.filter((d) => coversDay(o, d));
}

/** A run that covers more than one calendar day. */
export const isMultiDay = (o: Pick<OpenCall, "date" | "endDate">): boolean =>
  o.date != null && o.endDate != null && keyOfMs(o.endDate) > keyOfMs(o.date);

export interface Candidate {
  member: PlannerMember;
  /** The person's WORST covered day (what decides whether they can take the whole call). */
  day: DayState;
}

/** The worst of a person's states across `days` (Unavailable/booked anywhere sinks the whole run). */
function worstDay(m: PlannerMember, days: readonly string[]): DayState | null {
  let worst: DayState | null = null;
  for (const d of days) {
    const s = dayState(m, d);
    const rank = SUGGEST_RANK[s.kind];
    if (rank === undefined) return s;
    if (!worst || rank > SUGGEST_RANK[worst.kind]!) worst = s;
  }
  return worst;
}

/**
 * Who could fill an open call: people with the call's role (any role when the
 * call has none), not already on that service, whose day is Preferred, Free
 * or Pencilled on EVERY day of `days` (the days of the visible window the
 * service covers, or the one day being offered) — preferred first, then by
 * last name. Advisory: the server still decides the rate and the offer gate.
 */
export function candidatesFor(o: OpenCall, members: PlannerMember[], days: readonly string[]): Candidate[] {
  if (days.length === 0) return [];
  const out: Candidate[] = [];
  for (const m of members) {
    if (o.crewRoleId && m.crewRole?.id !== o.crewRoleId) continue;
    if (m.assignments.some((c) => c.serviceId === o.serviceId && isActiveCall(c))) continue;
    const state = worstDay(m, days);
    if (state && SUGGEST_RANK[state.kind] !== undefined) out.push({ member: m, day: state });
  }
  return out.sort((a, b) => SUGGEST_RANK[a.day.kind]! - SUGGEST_RANK[b.day.kind]! || byLastName(a.member, b.member));
}

export interface SuggestedOffer {
  open: OpenCall;
  member: PlannerMember;
}

/**
 * What `Offer to suggested n` would send: for each open call (its whole run),
 * up to its shortfall, the candidates free or preferred on every day of the
 * window it covers (never pencilled). One person is suggested once per DAY
 * across the batch — a multi-day run claims every day it covers — so two calls
 * on a shared day never go to the same person. `unfilled` names the calls left
 * with no one.
 */
export function planSuggestedOffers(opens: OpenCall[], members: PlannerMember[], window: readonly string[]): { offers: SuggestedOffer[]; unfilled: OpenCall[] } {
  const used = new Set<string>();
  const offers: SuggestedOffer[] = [];
  const unfilled: OpenCall[] = [];
  for (const open of opens) {
    const days = daysCovered(open, window);
    const free = (id: string) => days.every((d) => !used.has(`${id}:${d}`));
    const picks = candidatesFor(open, members, days)
      .filter((c) => c.day.kind !== "pencilled" && free(c.member.id))
      .slice(0, Math.max(0, open.shortfall));
    for (const p of picks) {
      for (const d of days) used.add(`${p.member.id}:${d}`);
      offers.push({ open, member: p.member });
    }
    if (picks.length < open.shortfall) unfilled.push(open);
  }
  return { offers, unfilled };
}
