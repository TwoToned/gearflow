"use client";

import { Users } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useProjectVersion } from "@/components/projects/project-version-context";

/** Read-only projection of Labour & logistics (services + crew) for a
 *  non-live version — same shared mapper as Equipment/Finance (R-3.1). Crew
 *  workflow status (offered/confirmed/responses) is never versioned (it's
 *  real-world truth, `convex/lib/projectSnapshots.ts` `CREW_WORKFLOW_FIELDS`)
 *  so it isn't shown here — only the rate/hours figures a version froze. */
export function VersionProjectedLabour() {
  const { projected, isLoadingProjection, viewingRevision } = useProjectVersion();

  if (isLoadingProjection) {
    return <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">Loading v{viewingRevision}…</div>;
  }
  if (!projected) return null;

  const { services, crew } = projected;

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
        <h3 className="text-card-title font-bold text-ink">Services</h3>
        {services.length === 0 ? (
          <p className="mt-2 text-caption text-muted">No services captured for v{viewingRevision}.</p>
        ) : (
          <div className="mt-1">
            {services.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-ui-text first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-ink-2">{s.title || "Untitled service"}</span>
                <span className="shrink-0 tabular-nums text-ink-2">
                  {s.lineTotal != null ? formatCurrency(s.lineTotal) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-ink-2" aria-hidden />
          <h3 className="text-card-title font-bold text-ink">Crew</h3>
        </div>
        {crew.length === 0 ? (
          <p className="mt-2 text-caption text-muted">No crew assignments captured for v{viewingRevision}.</p>
        ) : (
          <div className="mt-1">
            {crew.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-ui-text first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  {c.crewMemberId}
                  {c.isProjectManager ? " · PM" : ""}
                </span>
                <span className="shrink-0 tabular-nums text-ink-2">
                  {c.estimatedCost != null ? formatCurrency(c.estimatedCost) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-caption text-muted">
          Crew responses and confirmation status aren&apos;t versioned — that&apos;s live warehouse/roster
          state, not a quoting artifact.
        </p>
      </div>
    </div>
  );
}
