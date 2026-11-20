"use client";

import { useCallback, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { jobByNumber, jobLookup, tagLookup, type LookupResult } from "@/lib/floor-lookup";
import type { FloorJob } from "@/lib/warehouse-floor";

export interface FloorScanEntry extends LookupResult {
  id: string;
}

const MAX_ENTRIES = 5;

/**
 * The floor's `Look up` pipeline (spec §9c.3): ONE path for a scanned or typed
 * value. A job number rings its card; anything else goes through
 * `scanLookup.resolve` once (a one-shot read, never a subscription). The result
 * is decided by `src/lib/floor-lookup.ts`; this hook keeps the last five and
 * reports the card to ring. Look up writes nothing, so there is no Undo.
 */
export function useFloorScan(opts: {
  orgId: string | undefined;
  jobs: readonly FloorJob[];
  onRing: (jobId: string) => void;
}) {
  const convex = useConvex();
  const [entries, setEntries] = useState<FloorScanEntry[]>([]);
  const { orgId, jobs, onRing } = opts;

  const push = useCallback(
    (r: LookupResult) => {
      setEntries((prev) => [{ ...r, id: `${Date.now()}-${prev.length}` }, ...prev].slice(0, MAX_ENTRIES));
      if (r.ringJobId) onRing(r.ringJobId);
    },
    [onRing],
  );

  const scan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      const job = jobByNumber(jobs, value);
      if (job) return push(jobLookup(job));
      if (!orgId) return;
      try {
        const res = await convex.query(api.scanLookup.resolve, { orgId, value });
        push(tagLookup(value, res, jobs));
      } catch {
        push({ tone: "error", text: `${value} · look up failed, scan again`, ringJobId: null, openHref: null });
      }
    },
    [convex, orgId, jobs, push],
  );

  const dismiss = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), []);

  return { entries, scan, dismiss };
}
