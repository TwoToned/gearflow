import { isOpenMaintenance, isOverdueMaintenance, overdueCutoff } from "../../convex/lib/maintenanceOpen";
import { maintenanceStatusLabels } from "@/lib/status-labels";
import type { ColorIntent } from "@/lib/status-colors";

/**
 * A maintenance record's DERIVED words and checks (UX Phase 14, 14b-3, §9n.2): the header word
 * (`Awaiting parts`, `18d overdue`, `Completed`) and the Overview's `n of m checks clear`. Nothing here is stored.
 * Overdue is THE one rule (`convex/lib/maintenanceOpen.ts`, the scheduled DAY before today). A check whose input has
 * not arrived (the parts read) is `not checked`, never a pass. Pure: the page, the phone and the tests read it.
 */

const DAY_MS = 86_400_000;

export interface MaintenanceFacts {
  status: string;
  /** Epoch ms. */
  scheduledDate: number | null;
  now: number;
  assetCount: number;
  assigned: boolean;
  /** The parts summary, or `null` while the read has not arrived. */
  parts: { count: number; onOrder: number; late: number; nextEta: number | null } | null;
}

/** Whole days the scheduled DAY is before today (1 = yesterday), or 0 when it is not past. */
export function daysOverdue(scheduledDate: number | null, now: number): number {
  if (scheduledDate == null) return 0;
  const cutoff = overdueCutoff(now);
  if (scheduledDate >= cutoff) return 0;
  const scheduledDay = Math.floor(scheduledDate / DAY_MS) * DAY_MS;
  return Math.max(1, Math.round((cutoff - scheduledDay) / DAY_MS));
}

export interface StateWord {
  label: string;
  intent: ColorIntent;
  /** A closed job: an outline dot. */
  outline?: boolean;
}

/** The one word the header carries. */
export function maintenanceStateWord(f: Pick<MaintenanceFacts, "status" | "scheduledDate" | "now">): StateWord {
  if (f.status === "COMPLETED") return { label: "Completed", intent: "success" };
  if (f.status === "CANCELLED") return { label: "Cancelled", intent: "neutral", outline: true };
  if (isOverdueMaintenance({ status: f.status, scheduledDate: f.scheduledDate }, f.now)) {
    return { label: `${daysOverdue(f.scheduledDate, f.now)}d overdue`, intent: "error" };
  }
  if (f.status === "AWAITING_PARTS") return { label: "Awaiting parts", intent: "warning" };
  if (f.status === "QA") return { label: "In QA", intent: "warning" };
  if (f.status === "IN_PROGRESS") return { label: "In progress", intent: "primary" };
  return { label: maintenanceStatusLabels[f.status] ?? "Scheduled", intent: "info" };
}

/** Where a failing check's one muted action goes. */
export type CheckFix = "edit" | "parts" | "assets" | "complete";

interface MaintenanceCheck {
  key: string;
  text: string;
  tone: "error" | "warning" | "neutral";
  fix?: CheckFix;
}

export interface MaintenanceChecks {
  /** A closed job has no checks (it is done). */
  closed: boolean;
  total: number;
  clear: number;
  /** Only what needs a look, most serious first. */
  items: MaintenanceCheck[];
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Each check answers with the one item that needs a look, or `null` when it is clear. */
function assetsCheck(f: MaintenanceFacts): MaintenanceCheck | null {
  return f.assetCount === 0 ? { key: "assets", text: "No gear is linked to this job", tone: "error", fix: "edit" } : null;
}

function dateCheck(f: MaintenanceFacts): MaintenanceCheck | null {
  if (f.scheduledDate == null) return { key: "date", text: "No date is set", tone: "warning", fix: "edit" };
  if (!isOverdueMaintenance({ status: f.status, scheduledDate: f.scheduledDate }, f.now)) return null;
  return { key: "date", text: `${plural(daysOverdue(f.scheduledDate, f.now), "day")} overdue (was ${dayLabel(f.scheduledDate)})`, tone: "error", fix: "complete" };
}

function partsCheck(f: MaintenanceFacts): MaintenanceCheck | null {
  const p = f.parts;
  if (p == null) return { key: "parts", text: "Parts not checked", tone: "neutral", fix: "parts" };
  if (p.late > 0) return { key: "parts", text: `${plural(p.late, "part")} past ETA`, tone: "warning", fix: "parts" };
  if (p.onOrder === 0) return null;
  const eta = p.nextEta != null ? ` · next ${dayLabel(p.nextEta)}` : "";
  return { key: "parts", text: `${plural(p.onOrder, "part")} on order${eta}`, tone: "warning", fix: "parts" };
}

function assignedCheck(f: MaintenanceFacts): MaintenanceCheck | null {
  return f.assigned ? null : { key: "assigned", text: "Nobody is assigned", tone: "neutral", fix: "edit" };
}

const CHECKS = [assetsCheck, dateCheck, partsCheck, assignedCheck] as const;
const TONE_RANK = { error: 0, warning: 1, neutral: 2 } as const;

/** The four checks: it has gear, it has a date that is not past, its parts are in, someone owns it. */
export function maintenanceChecks(f: MaintenanceFacts): MaintenanceChecks {
  if (!isOpenMaintenance(f.status)) return { closed: true, total: 0, clear: 0, items: [] };
  const items = CHECKS.map((check) => check(f)).filter((i): i is MaintenanceCheck => i !== null);
  items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return { closed: false, total: CHECKS.length, clear: CHECKS.length - items.length, items };
}
