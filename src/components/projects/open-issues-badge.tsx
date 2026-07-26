"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { cn, focusRing } from "@/lib/utils";

/**
 * "Open issues" indicator (GitHub #898, FEATUREDOCS/64) — counts open
 * MaintenanceRecords with `incidentType` set (Report Issue / an immediate
 * check-item FAIL) for this project. Hidden entirely at zero.
 */
export function OpenIssuesBadge({ orgId, projectId }: { orgId?: string; projectId: string }) {
  const records = useAuthedQuery(
    api.maintenanceRecords.list,
    orgId ? { orgId } : "skip",
  ) as Array<{ projectId?: string; incidentType?: string | null; status?: string | null }> | undefined;

  const openCount = (records ?? []).filter(
    (r) => r.projectId === projectId && r.incidentType != null && r.status !== "COMPLETED" && r.status !== "CANCELLED",
  ).length;

  if (openCount === 0) return null;

  return (
    <Link
      href={`/warehouse/${projectId}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-badge font-bold text-warn transition-colors hover:opacity-80",
        focusRing,
      )}
      title={`${openCount} open equipment issue${openCount !== 1 ? "s" : ""}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {openCount} open issue{openCount !== 1 ? "s" : ""}
    </Link>
  );
}
