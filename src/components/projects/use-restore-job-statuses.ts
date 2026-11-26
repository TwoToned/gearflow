"use client";

import { useConvex } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { plural } from "@/lib/list-write-toast";

/**
 * The ONE Undo for a status write on several jobs (the Jobs list's `Set status`,
 * `Cancel`, and the Schedule's `Confirm n` all hand a toast this closure). It
 * restores each row to the status it had before the write, but ONLY rows whose
 * LIVE status (read from the server at undo time, never the snapshot) is still
 * the one the write set. Rows that moved on since are left alone and named in
 * the toast. Never a second reverse implementation.
 */
export function useRestoreJobStatuses(orgId: string | undefined) {
  const convex = useConvex();
  const statusWrites = useNativeProjectStatus(orgId);
  return (rows: { id: string; status?: string | null }[], wrote: string) => async (): Promise<string | void> => {
    if (!orgId) return;
    const live = await convex.query(api.projects.listByIds, { orgId, ids: rows.map((r) => r.id) });
    const current = new Map(live.map((p) => [p.id, p.status ?? "ENQUIRY"]));
    let movedOn = 0;
    for (const r of rows) {
      if (current.get(r.id) !== wrote) {
        movedOn++;
        continue;
      }
      await statusWrites.updateStatus(r.id, r.status ?? "ENQUIRY");
    }
    return movedOn > 0 ? `${plural(movedOn, "job")} had moved on, left as ${movedOn === 1 ? "it is" : "they are"}` : undefined;
  };
}
