/**
 * Pure derivations for the Job › Logistics tab (UX Phase 5, spec §8): lanes,
 * the "needs you" counts, day grouping, call-time text and the date-move plan.
 * Everything here is derived from the services the page already loads and is
 * never stored (R-3.1) — the tab, the phone day mode and the footer all read
 * these one definitions.
 */
import { isFilledAssignmentStatus } from "@/lib/crew-assignment-status";

export type ServiceType = "DELIVERY" | "PICKUP" | "BUMP_IN" | "BUMP_OUT" | "LABOUR" | "MISC";
export type ServiceStatus = "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface LogisticsAssignment {
  id: string;
  status: string;
  estimatedCost: number | null;
  crewMember: { id: string; firstName: string; lastName: string; image: string | null };
}

export interface LogisticsService {
  id: string;
  type: ServiceType;
  title: string;
  /** ISO string (server actions serialise dates). */
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  scheduledTime: string | null;
  status: ServiceStatus;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes?: string | null;
  vehicleDescription: string | null;
  numberOfTrips?: number | null;
  lineTotal: number | null;
  costTotal: number | null;
  crewCountRequired: number | null;
  crewRole: { id: string; name: string; color: string | null } | null;
  crewAssignments: LogisticsAssignment[];
}

export const LANES = ["all", "transport", "site", "labour", "needs"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABELS: Record<Lane, string> = {
  all: "All",
  transport: "Transport",
  site: "Site",
  labour: "Labour",
  needs: "Needs crew",
};

const TYPE_LANE: Record<ServiceType, Exclude<Lane, "all" | "needs">> = {
  DELIVERY: "transport",
  PICKUP: "transport",
  BUMP_IN: "site",
  BUMP_OUT: "site",
  MISC: "site",
  LABOUR: "labour",
};

/** Words for the type; the same labels `SERVICE_TYPE_LABELS` carries, sentence case. */
export const TYPE_WORDS: Record<ServiceType, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump in",
  BUMP_OUT: "Bump out",
  LABOUR: "Labour",
  MISC: "Misc",
};

const ISO_DAY = (v: string | null): string => (v ? new Date(v).toISOString().slice(0, 10) : "");
export const dayKeyOf = ISO_DAY;

export function laneOf(type: ServiceType): Exclude<Lane, "all" | "needs"> {
  return TYPE_LANE[type];
}

// ─── Crew state (derived) ───────────────────────────────────────────────────

export const filledOf = (s: LogisticsService): LogisticsAssignment[] =>
  s.crewAssignments.filter((a) => isFilledAssignmentStatus(a.status));

/** How many more people the service needs. A cancelled service needs nobody. */
export function crewShort(s: LogisticsService): number {
  if (s.status === "CANCELLED") return 0;
  return Math.max((s.crewCountRequired ?? 0) - filledOf(s).length, 0);
}

const countStatus = (s: LogisticsService, status: string): number =>
  s.crewAssignments.filter((a) => a.status === status).length;
export const toOffer = (s: LogisticsService): number => countStatus(s, "PENDING");
export const unanswered = (s: LogisticsService): number => countStatus(s, "OFFERED");

export interface LogisticsTotals {
  services: number;
  crew: number;
  confirmedCrew: number;
  servicesShort: number;
  toOffer: number;
  unanswered: number;
}

export function totalsOf(services: LogisticsService[]): LogisticsTotals {
  const live = services.filter((s) => s.status !== "CANCELLED");
  const filled = live.flatMap(filledOf);
  return {
    services: live.length,
    crew: filled.length,
    confirmedCrew: filled.filter((a) => a.status === "CONFIRMED" || a.status === "COMPLETED").length,
    servicesShort: live.filter((s) => crewShort(s) > 0).length,
    toOffer: live.reduce((n, s) => n + toOffer(s), 0),
    unanswered: live.reduce((n, s) => n + unanswered(s), 0),
  };
}

/** `3 short of crew · 4 to offer · 1 unanswered`; empty when nothing needs you. */
export function needsLine(t: LogisticsTotals): string {
  const parts: string[] = [];
  if (t.servicesShort) parts.push(`${t.servicesShort} short of crew`);
  if (t.toOffer) parts.push(`${t.toOffer} to offer`);
  if (t.unanswered) parts.push(`${t.unanswered} unanswered`);
  return parts.join(" · ");
}

export function inLane(s: LogisticsService, lane: Lane): boolean {
  if (lane === "all") return true;
  if (lane === "needs") return crewShort(s) > 0 || toOffer(s) > 0 || unanswered(s) > 0;
  return laneOf(s.type) === lane;
}

// ─── Days ───────────────────────────────────────────────────────────────────

export interface DayGroup {
  /** `YYYY-MM-DD`, or "" for unscheduled. */
  key: string;
  services: LogisticsService[];
}

const timeOf = (s: LogisticsService): string => s.startTime ?? s.scheduledTime ?? "99:99";

/** Services grouped by their start day, days ascending, unscheduled last, then by call time. */
export function groupByDay(services: LogisticsService[]): DayGroup[] {
  const map = new Map<string, LogisticsService[]>();
  for (const s of services) {
    const k = dayKeyOf(s.date);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([key, list]) => ({ key, services: [...list].sort((x, y) => timeOf(x).localeCompare(timeOf(y))) }));
}

/** The call window: `08:00 – 16:00`, or just the start, or a truck time for transport. */
export function whenText(s: LogisticsService): string {
  if (s.startTime) return s.endTime ? `${s.startTime} – ${s.endTime}` : s.startTime;
  if (s.scheduledTime) return s.scheduledTime;
  return "";
}

/** The truck's own time for transport (`drop 07:00` / `collect 06:00`). */
export function truckText(s: LogisticsService): string {
  if (!s.scheduledTime) return "";
  if (s.type === "DELIVERY") return `drop ${s.scheduledTime}`;
  if (s.type === "PICKUP") return `collect ${s.scheduledTime}`;
  return "";
}

/** Default start day for a new service of `type`, from the project window (`YYYY-MM-DD` or ""). */
export function defaultServiceDay(type: ServiceType | null, w: { start: string; end: string }): string {
  switch (type) {
    case "PICKUP":
    case "BUMP_OUT":
      return w.end || w.start;
    default:
      return w.start || w.end;
  }
}

// ─── Moving the window (linked re-timing) ───────────────────────────────────

const DAY_MS = 86_400_000;

/** Whole days from one `YYYY-MM-DD` to another (positive = later). */
export function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
}

export interface ShiftMove {
  offsetDays: number;
  serviceIds: string[];
}

/**
 * Which services follow which end of the window: delivery and bump in follow
 * load in; bump out and pickup follow load out. Labour and misc stay put (they
 * span the job; the user moves them by hand). Cancelled and undated services
 * stay put. Empty groups and zero offsets are dropped.
 */
export function planShift(
  services: LogisticsService[],
  moved: { loadInDays: number; loadOutDays: number },
): ShiftMove[] {
  const follows = (types: ServiceType[]) =>
    services.filter((s) => s.date && s.status !== "CANCELLED" && types.includes(s.type)).map((s) => s.id);
  return [
    { offsetDays: moved.loadInDays, serviceIds: follows(["DELIVERY", "BUMP_IN"]) },
    { offsetDays: moved.loadOutDays, serviceIds: follows(["BUMP_OUT", "PICKUP"]) },
  ].filter((m) => m.offsetDays !== 0 && m.serviceIds.length > 0);
}

export const reverseMoves = (moves: ShiftMove[]): ShiftMove[] =>
  moves.map((m) => ({ ...m, offsetDays: -m.offsetDays }));

// ─── Words for a day ────────────────────────────────────────────────────────

const dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayShortFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

/** `Tue 11 Nov` (service dates are UTC-midnight days), or `Unscheduled`. */
export function dayLabel(key: string): string {
  return key ? dayFmt.format(new Date(key)).replace(",", "") : "Unscheduled";
}

/** `11 Nov`: the compact form used in the facts strip. */
export function dayShortLabel(key: string): string {
  return key ? dayShortFmt.format(new Date(key)) : "";
}

// ─── Pick crew ──────────────────────────────────────────────────────────────

/** Preferred, available, pencilled, booked (spec §8). `null` = nothing to say = available. */
export function crewPickRank(severity: "hard" | "soft" | "preferred" | null): number {
  switch (severity) {
    case "preferred": return 0;
    case null: return 1;
    case "soft": return 2;
    case "hard": return 3;
  }
}
