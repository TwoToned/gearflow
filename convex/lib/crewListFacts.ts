/**
 * The Crew list's derived facts (UX Phase 13, spec §9f.2, D38/D40). Pure: no ctx,
 * no clock. `today` is a day number (`Math.floor(ms / DAY_MS)`), never stored, never
 * a fresh read, so a test pins every edge and the server and the page cannot disagree.
 *
 * - **Unconfirmed**: a live call still at PENDING / OFFERED / ACCEPTED (the crew
 *   member has not been confirmed on it) that has not ended.
 * - **On a job**: a CONFIRMED call covering today or any day of the next 7.
 * - **Available this week** (D40): active, not on leave, nothing CONFIRMED in the
 *   next seven days (today + 6), not Mon–Sun.
 * - Precedence: Inactive/On leave (stored) > Unconfirmed > On a job > Available.
 * Calls are only ever read for a bounded window, so a call that began before it is out
 * of scope (the query documents and tests that).
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** "This week" is the next seven days, today included (D40). */
export const WEEK_DAYS = 7;

export type CrewListStatus = "UNCONFIRMED" | "ON_JOB" | "AVAILABLE" | "ON_LEAVE" | "INACTIVE";
export const CREW_SEGMENT_KEYS = ["all", "available", "onjob", "unconfirmed", "inactive"] as const;
export type CrewSegmentKey = (typeof CREW_SEGMENT_KEYS)[number];

export interface CrewFactMember {
  id: string;
  status?: string | null;
  isActive?: boolean | null;
}
export interface CrewFactCall {
  id: string;
  crewMemberId: string;
  projectId: string;
  status?: string | null;
  startDate?: number | null;
  endDate?: number | null;
}
export interface CrewMemberFacts {
  status: CrewListStatus;
  /** Earliest live call that has not ended: `{ callId, projectId, startDay, status }`. */
  next: { callId: string; projectId: string; startDay: number | null; status: string } | null;
  /** Days with a CONFIRMED call in `[today, today + 6]`. */
  daysThisWeek: number;
  /** First overlap between two live calls (a day number), for the `clash 14 Nov` flag. */
  clashDay: number | null;
}

const UNCONFIRMED = new Set(["PENDING", "OFFERED", "ACCEPTED"]);
const LIVE = new Set(["PENDING", "OFFERED", "ACCEPTED", "CONFIRMED"]);

export const dayNumber = (ms: number): number => Math.floor(ms / DAY_MS);

function span(c: CrewFactCall): { s: number; e: number } | null {
  if (c.startDate == null && c.endDate == null) return null;
  const s = dayNumber((c.startDate ?? c.endDate) as number);
  const e = dayNumber((c.endDate ?? c.startDate) as number);
  return { s, e: Math.max(s, e) };
}

function storedStatus(m: CrewFactMember): CrewListStatus | null {
  if ((m.isActive ?? true) === false) return "INACTIVE";
  const s = m.status ?? "ACTIVE";
  if (s === "INACTIVE" || s === "ARCHIVED") return "INACTIVE";
  if (s === "ON_LEAVE") return "ON_LEAVE";
  return null;
}

function firstClash(spans: { s: number; e: number }[]): number | null {
  const sorted = [...spans].sort((a, b) => a.s - b.s);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].s <= sorted[i - 1].e) return sorted[i].s;
  return null;
}

function weekDays(confirmed: { s: number; e: number }[], today: number): number {
  const days = new Set<number>();
  for (const { s, e } of confirmed) {
    for (let d = Math.max(s, today); d <= Math.min(e, today + WEEK_DAYS - 1); d++) days.add(d);
  }
  return days.size;
}

/** The facts for one member from THEIR calls (already filtered to the member). */
export function crewMemberFacts(member: CrewFactMember, calls: CrewFactCall[], today: number): CrewMemberFacts {
  const liveCalls = calls.filter((c) => LIVE.has(c.status ?? "PENDING"));
  // A live call with NO dates (a PENDING call on a job with no rental window) is still real:
  // it makes the person Unconfirmed and shows as their Next call, undated, after any dated one.
  const dated = liveCalls
    .map((c) => ({ c, sp: span(c) }))
    .filter((x): x is { c: CrewFactCall; sp: { s: number; e: number } } => x.sp != null && x.sp.e >= today)
    .sort((a, b) => a.sp.s - b.sp.s);
  const undated = liveCalls.filter((c) => span(c) == null);
  const confirmed = dated.filter((x) => x.c.status === "CONFIRMED").map((x) => x.sp);
  const stored = storedStatus(member);
  const unconfirmed = [...dated.map((x) => x.c), ...undated].some((c) => UNCONFIRMED.has(c.status ?? "PENDING"));
  const onJob = confirmed.some((sp) => sp.s <= today + WEEK_DAYS - 1);
  const status: CrewListStatus = stored ?? (unconfirmed ? "UNCONFIRMED" : onJob ? "ON_JOB" : "AVAILABLE");
  const first = dated[0];
  const next = first
    ? { callId: first.c.id, projectId: first.c.projectId, startDay: first.sp.s as number | null, status: first.c.status ?? "PENDING" }
    : undated[0]
      ? { callId: undated[0].id, projectId: undated[0].projectId, startDay: null as number | null, status: undated[0].status ?? "PENDING" }
      : null;
  return { status, next, daysThisWeek: weekDays(confirmed, today), clashDay: firstClash(dated.map((x) => x.sp)) };
}

/** Does a member with `facts` belong in `segment`? (`all` = everyone not parked as Inactive.) */
export function inCrewSegment(facts: CrewMemberFacts, segment: CrewSegmentKey): boolean {
  switch (segment) {
    case "all":
      return facts.status !== "INACTIVE";
    case "available":
      return facts.status === "AVAILABLE";
    case "onjob":
      return facts.status === "ON_JOB" || facts.status === "UNCONFIRMED";
    case "unconfirmed":
      return facts.status === "UNCONFIRMED";
    case "inactive":
      return facts.status === "INACTIVE";
  }
}

/** Sort rank for the default `status` sort: unconfirmed people lead. */
export const CREW_STATUS_RANK: Record<CrewListStatus, number> = { UNCONFIRMED: 0, ON_JOB: 1, AVAILABLE: 2, ON_LEAVE: 3, INACTIVE: 4 };

export function groupCallsByMember(calls: CrewFactCall[]): Map<string, CrewFactCall[]> {
  const out = new Map<string, CrewFactCall[]>();
  for (const c of calls) {
    const list = out.get(c.crewMemberId);
    if (list) list.push(c);
    else out.set(c.crewMemberId, [c]);
  }
  return out;
}
