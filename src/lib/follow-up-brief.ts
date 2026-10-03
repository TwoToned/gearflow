/**
 * Follow-up automation — the morning brief's pure logic (design §8.6,
 * FEATUREDOCS/82). Kept out of the `"use server"` sender so it's unit-testable
 * and so the sender stays a thin I/O shell.
 */
import { startOfDayInTimezone } from "@/lib/quote-validity";
import type { FollowUpBriefItem } from "@/lib/notification-emails";

/** Local hour (0-23), weekday (0 Sun – 6 Sat) and YYYY-MM-DD of `nowMs` in `timezone`. */
export function localClock(nowMs: number, timezone: string): { hour: number; weekday: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { hour: Number(get("hour")), weekday, dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}

/** The brief goes out from 07:00 org time on business days; the dedupe key
 *  (one per person per local date) makes every later hourly tick a no-op. */
const BRIEF_HOUR = 7;

export function isBriefWindow(nowMs: number, timezone: string): boolean {
  const { hour, weekday } = localClock(nowMs, timezone);
  return weekday >= 1 && weekday <= 5 && hour >= BRIEF_HOUR;
}

export function briefDedupeKey(orgId: string, userId: string, dateKey: string): string {
  return `follow-up-brief:${orgId}:${userId}:${dateKey}`;
}

export interface BriefRow {
  id: string;
  title: string;
  why: string;
  urgent: boolean;
  rung: number;
  dueDate: number;
  assigneeUserId: string;
  projectId: string | null;
}

/** One person's brief: chasing rungs vs decisions, urgent first then oldest. */
export function groupBrief(rows: BriefRow[], nowMs: number, timezone: string): Map<string, { chase: FollowUpBriefItem[]; decide: FollowUpBriefItem[] }> {
  const todayStart = startOfDayInTimezone(nowMs, timezone);
  const sorted = [...rows].sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.dueDate - b.dueDate);
  const out = new Map<string, { chase: FollowUpBriefItem[]; decide: FollowUpBriefItem[] }>();
  for (const r of sorted) {
    const bucket = out.get(r.assigneeUserId) ?? { chase: [], decide: [] };
    const item: FollowUpBriefItem = {
      title: r.title,
      why: r.why,
      href: r.projectId ? `/projects/${r.projectId}?tab=work` : "/dashboard",
      urgent: r.urgent,
      overdue: r.dueDate < todayStart,
    };
    (r.rung === 1 || r.rung === 2 ? bucket.chase : bucket.decide).push(item);
    out.set(r.assigneeUserId, bucket);
  }
  return out;
}

// ─── Urgent phone push (design D3) ────────────────────────────────────────

/** Pushes per person per local day — push is the loudest channel, so it's
 *  rationed hard; everything else waits for the brief and the dashboard. */
export const FOLLOW_UP_PUSH_DAILY_CAP = 2;
/** Quiet hours: nothing buzzes before 07:00 or from 19:00 org time. */
const PUSH_START_HOUR = 7;
const PUSH_END_HOUR = 19;

export function isPushWindow(nowMs: number, timezone: string): boolean {
  const { hour } = localClock(nowMs, timezone);
  return hour >= PUSH_START_HOUR && hour < PUSH_END_HOUR;
}

/** One push per follow-up RUNG (a later rung of the same loop may push again),
 *  and the per-person day prefix the daily slots hang off. */
export function pushKeys(orgId: string, row: Pick<BriefRow, "id" | "rung" | "assigneeUserId">, dateKey: string): { itemKey: string; dayKey: string } {
  return {
    itemKey: `follow-up-push:${orgId}:${row.id}:${row.rung}`,
    dayKey: `follow-up-push-day:${orgId}:${row.assigneeUserId}:${dateKey}`,
  };
}

/** The urgent rows, most pressing first (oldest due date). */
export function urgentPushRows(rows: BriefRow[]): BriefRow[] {
  return rows.filter((r) => r.urgent).sort((a, b) => a.dueDate - b.dueDate);
}

export function pushPayload(row: BriefRow): { title: string; body: string; href: string; tag: string } {
  return {
    title: row.title,
    body: row.why,
    href: row.projectId ? `/projects/${row.projectId}?tab=work` : "/dashboard",
    tag: `follow-up:${row.id}`,
  };
}
