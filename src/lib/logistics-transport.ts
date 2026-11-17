/**
 * Sub-hire transport on the Logistics timeline (spec 8, approved 2026-11-17).
 *
 * A sub-hire order linked to the job implies two runs: gear is collected from
 * the supplier on `hireStart` and returned to them on `hireEnd`. These are
 * DERIVED, read-only stops: never stored as `projectServices`, never priced
 * (the order owns its money), recomputed from the order on every read, so they
 * cannot drift from it (R-3.1). Pure: no hooks, no JSX.
 */
import { dayKeyOf, type DayGroup } from "@/lib/logistics-model";

export interface SubHireOrderLite {
  id: string;
  supplierId: string;
  orderNumber: string;
  status?: string;
  hireStart?: number;
  hireEnd?: number;
}

export interface TransportStop {
  /** `<orderId>:collect` / `<orderId>:return`; stable across renders. */
  id: string;
  subHireId: string;
  kind: "collect" | "return";
  /** `YYYY-MM-DD`. */
  day: string;
  /** `Collect from Acme Hire` / `Return to Acme Hire`. */
  title: string;
  orderNumber: string;
}

const dayOf = (ms: number): string => dayKeyOf(new Date(ms).toISOString());

/** Two stops per dated order; a cancelled order moves nothing. Sorted by day, collects before returns. */
export function subHireStops(orders: SubHireOrderLite[], supplierName: (supplierId: string) => string): TransportStop[] {
  const stops: TransportStop[] = [];
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    const who = supplierName(o.supplierId) || "supplier";
    if (typeof o.hireStart === "number") {
      stops.push({ id: o.id + ":collect", subHireId: o.id, kind: "collect", day: dayOf(o.hireStart), title: "Collect from " + who, orderNumber: o.orderNumber });
    }
    if (typeof o.hireEnd === "number") {
      stops.push({ id: o.id + ":return", subHireId: o.id, kind: "return", day: dayOf(o.hireEnd), title: "Return to " + who, orderNumber: o.orderNumber });
    }
  }
  return stops.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.orderNumber.localeCompare(b.orderNumber));
}

/** Fold the stops into the day groups, adding a day where only a stop falls on it. Days stay ascending. */
export function mergeStops(groups: DayGroup[], stops: TransportStop[]): DayGroup[] {
  if (stops.length === 0) return groups;
  const byDay = new Map<string, DayGroup>(groups.map((g) => [g.key, { ...g, stops: [] as TransportStop[] }]));
  for (const s of stops) {
    const g = byDay.get(s.day) ?? { key: s.day, services: [], stops: [] };
    g.stops = [...(g.stops ?? []), s];
    byDay.set(s.day, g);
  }
  return [...byDay.values()].sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key.localeCompare(b.key)));
}
