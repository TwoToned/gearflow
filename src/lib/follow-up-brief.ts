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
