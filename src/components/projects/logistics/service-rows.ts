/**
 * Maps the Logistics data set to the one row (`LineRowData`, spec §5.1). Both
 * renderings — the desktop timeline and the phone day cards — read the same
 * facts from here, so "one rendering of one data set" (D4) holds by
 * construction. Pure: no hooks, no JSX.
 */
import { SERVICE_STATUS_LABELS } from "@/lib/constants/services";
import {
  crewShort, filledOf, TYPE_WORDS, truckText, whenText,
  type LogisticsAssignment, type LogisticsService,
} from "@/lib/logistics-model";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, StatusValue } from "@/lib/primitives/types";
import { getStatusIntent } from "@/lib/status-colors";
import { assignmentStatusLabels } from "@/lib/status-labels";

/** When · Crew · On quote · Status (+ Cost · Margin when asked for). Item is the title column. */
export function logisticsColumns(showCost: boolean): FactColumn[] {
  return [
    { id: "when", header: "When" },
    { id: "crew", header: "Crew" },
    { id: "charge", header: "On quote", align: "end" },
    ...(showCost
      ? [
          { id: "cost", header: "Cost", align: "end" as const },
          { id: "margin", header: "Margin", align: "end" as const },
        ]
      : []),
    { id: "status", header: "Status" },
  ];
}

export const serviceStatusValue = (s: LogisticsService): StatusValue => ({
  label: SERVICE_STATUS_LABELS[s.status] ?? s.status,
  intent: getStatusIntent("service", s.status),
  outline: s.status === "COMPLETED" || s.status === "CANCELLED",
});

export const personName = (a: LogisticsAssignment): string => `${a.crewMember.firstName} ${a.crewMember.lastName}`;

/** Where, folded under the title as one muted line: address · truck · vehicle · trips. */
export function whereLine(s: LogisticsService): string {
  const trips = s.numberOfTrips && s.numberOfTrips > 1 ? `${s.numberOfTrips} trips` : "";
  return [s.address, truckText(s), s.vehicleDescription, trips].filter(Boolean).join(" · ");
}

/** `3 of 4`, `2 needed`, or `no crew`; the role leads when the service names one. */
export function crewText(s: LogisticsService): string {
  const filled = filledOf(s).length;
  const need = s.crewCountRequired ?? 0;
  const role = s.crewRole?.name;
  if (need <= 0 && filled === 0) return "no crew";
  const count = need > 0 ? `${filled} of ${need}` : `${filled}`;
  return [role, count].filter(Boolean).join(" · ");
}

const margin = (s: LogisticsService): number | null =>
  s.lineTotal != null && s.costTotal != null ? Number(s.lineTotal) - Number(s.costTotal) : null;

/** Charge column: the price, `internal` when only a cost exists, blank otherwise (never $0). */
function chargeFact(s: LogisticsService): Fact {
  if (s.lineTotal != null && Number(s.lineTotal) > 0) return { kind: "money", amount: Number(s.lineTotal) };
  if (s.costTotal != null && Number(s.costTotal) > 0) return { kind: "text", label: "internal" };
  return { kind: "money", amount: null };
}

/** The type as a muted tag, unless the title already says it (`Delivery · Delivery` is noise). */
export function typeTag(s: LogisticsService): string[] | undefined {
  const word = TYPE_WORDS[s.type];
  return s.title.trim().toLowerCase() === word.toLowerCase() ? undefined : [word];
}

function crewChild(a: LogisticsAssignment): LineRowData {
  return {
    id: a.id,
    kind: "crew",
    title: personName(a),
    facts: {
      status: { kind: "text", label: assignmentStatusLabels[a.status] ?? a.status },
      charge: { kind: "money", amount: a.estimatedCost != null && a.estimatedCost > 0 ? a.estimatedCost : null },
    },
  };
}

export function serviceRow(
  s: LogisticsService,
  opts: { menu?: ActionMenuSpec; showCost: boolean; onOpen?: () => void },
): LineRowData {
  const short = crewShort(s);
  const facts: Record<string, Fact> = {
    when: { kind: "time", at: whenText(s) || "—" },
    crew: { kind: "text", label: crewText(s) },
    charge: chargeFact(s),
  };
  if (opts.showCost) {
    facts.cost = { kind: "money", amount: s.costTotal != null && Number(s.costTotal) > 0 ? Number(s.costTotal) : null };
    facts.margin = { kind: "money", amount: margin(s) };
  }
  return {
    id: s.id,
    kind: "service",
    title: s.title,
    subtitle: whereLine(s) || undefined,
    tags: typeTag(s),
    flags: short ? [{ label: `${short} needed`, tone: "error" }] : undefined,
    facts,
    status: serviceStatusValue(s),
    menu: opts.menu,
    children: s.crewAssignments.length ? s.crewAssignments.map(crewChild) : undefined,
    onOpen: opts.onOpen,
  };
}
