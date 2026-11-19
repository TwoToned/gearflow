import type { FloorJob } from "@/lib/warehouse-floor";

export const DAY = 86_400_000;
/** A fixed local-noon "now" so day arithmetic never straddles midnight. */
export const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime();
export const TODAY = new Date(2026, 10, 17).getTime();

export function floorJob(over: Partial<FloorJob> & { id: string }): FloorJob {
  return {
    name: `Job ${over.id}`,
    projectNumber: over.id,
    status: "CONFIRMED",
    rentalStartDate: null,
    rentalEndDate: null,
    projectStartDate: TODAY + DAY,
    projectEndDate: TODAY + 3 * DAY,
    client: { name: "Acme" },
    clientId: "c1",
    lineItems: [],
    projectManagerId: null,
    packerUserId: null,
    counts: { lines: 2, linesToPick: 2, items: 4, packed: 0, out: 0, back: 0, damaged: 0, missing: 0 },
    stage: "topick",
    outbound: null,
    outboundTruncated: false,
    ...over,
  };
}
