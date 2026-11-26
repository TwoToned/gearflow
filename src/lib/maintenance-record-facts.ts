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

export interface MaintenanceCheck {
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

const CHECK_COUNT = 4;

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The four checks: it has gear, it has a date that is not past, its parts are in, someone owns it. */
export function maintenanceChecks(f: MaintenanceFacts): MaintenanceChecks {
  if (!isOpenMaintenance(f.status)) return { closed: true, total: 0, clear: 0, items: [] };
  const items: MaintenanceCheck[] = [];

  if (f.assetCount === 0) items.push({ key: "assets", text: "No gear is linked to this job", tone: "error", fix: "edit" });

  const late = daysOverdue(f.scheduledDate, f.now);
  if (f.scheduledDate == null) items.push({ key: "date", text: "No date is set", tone: "warning", fix: "edit" });
  else if (isOverdueMaintenance({ status: f.status, scheduledDate: f.scheduledDate }, f.now)) {
    items.push({ key: "date", text: `${late} day${late === 1 ? "" : "s"} overdue (was ${dayLabel(f.scheduledDate)})`, tone: "error", fix: "complete" });
  }

  if (f.parts == null) items.push({ key: "parts", text: "Parts not checked", tone: "neutral", fix: "parts" });
  else if (f.parts.late > 0) {
    items.push({ key: "parts", text: `${f.parts.late} part${f.parts.late === 1 ? "" : "s"} past ETA`, tone: "warning", fix: "parts" });
  } else if (f.parts.onOrder > 0) {
    const eta = f.parts.nextEta != null ? ` · next ${dayLabel(f.parts.nextEta)}` : "";
    items.push({ key: "parts", text: `${f.parts.onOrder} part${f.parts.onOrder === 1 ? "" : "s"} on order${eta}`, tone: "warning", fix: "parts" });
  }

  if (!f.assigned) items.push({ key: "assigned", text: "Nobody is assigned", tone: "neutral", fix: "edit" });

  const rank = { error: 0, warning: 1, neutral: 2 } as const;
  items.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return { closed: false, total: CHECK_COUNT, clear: CHECK_COUNT - items.length, items };
}
