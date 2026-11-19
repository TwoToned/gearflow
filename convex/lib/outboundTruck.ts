/**
 * When the gear leaves: the earliest OUTBOUND transport service of a job
 * (spec §9c.2 card line `Truck Tue 06:30 · Van 2`). The ONE derivation —
 * `warehouseList.bundle` calls it per job and the card only formats the
 * result. Nothing is stored.
 *
 * Outbound = a `DELIVERY` (our truck) or a `CLIENT_PICKUP` (the client
 * collects at our counter, UX 5b). The truck's own time is `scheduledTime`
 * (`HH:MM`, the service sheet's "When the truck drops" field, FEATUREDOCS/84),
 * on the service's `date`. Cancelled services never count. A service with no
 * date sorts last (it still beats having nothing). No service → `null`, and
 * the card falls back to `Out <job start>`.
 */

export const OUTBOUND_SERVICE_TYPES = ["DELIVERY", "CLIENT_PICKUP"] as const;

export interface OutboundServiceLike {
  type: string;
  status?: string | null;
  date?: number | null;
  scheduledTime?: string | null;
  vehicleDescription?: string | null;
}

export interface OutboundTruck {
  /** `truck` = our vehicle; `client` = the client collects. */
  kind: "truck" | "client";
  date: number | null;
  /** `HH:MM`, or null when the sheet has no truck time yet. */
  time: string | null;
  /** Ours only; a client's own vehicle is PII and never shown on the floor. */
  vehicle: string | null;
}

const TIME = /^\d{2}:\d{2}$/;

function sortKey(s: OutboundServiceLike): [number, string] {
  const time = s.scheduledTime && TIME.test(s.scheduledTime) ? s.scheduledTime : "99:99";
  return [s.date ?? Number.MAX_SAFE_INTEGER, time];
}

function earlier(a: OutboundServiceLike, b: OutboundServiceLike): boolean {
  const [ad, at] = sortKey(a);
  const [bd, bt] = sortKey(b);
  return ad !== bd ? ad < bd : at < bt;
}

/** A live (not cancelled) outbound service. */
export function isOutboundService(s: OutboundServiceLike): boolean {
  return (OUTBOUND_SERVICE_TYPES as readonly string[]).includes(s.type) && s.status !== "CANCELLED";
}

export function earliestOutbound(services: readonly OutboundServiceLike[]): OutboundTruck | null {
  let best: OutboundServiceLike | null = null;
  for (const s of services) {
    if (!isOutboundService(s)) continue;
    if (!best || earlier(s, best)) best = s;
  }
  if (!best) return null;
  const client = best.type === "CLIENT_PICKUP";
  const time = best.scheduledTime && TIME.test(best.scheduledTime) ? best.scheduledTime : null;
  return {
    kind: client ? "client" : "truck",
    date: best.date ?? null,
    time,
    vehicle: client ? null : best.vehicleDescription?.trim() || null,
  };
}
