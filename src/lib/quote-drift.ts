import type { DiffRow } from "@/lib/project-snapshot-diff";

/**
 * Drift summary (#989 §6.5) — "this job no longer matches the document the
 * client is holding." Nearly free to build: `diffSnapshotEntries` already
 * compares a sent revision's frozen snapshot against current live state
 * (`src/lib/project-snapshot-diff.ts`); this just buckets the resulting rows
 * by kind for a one-line summary instead of a raw diff list.
 *
 * Deliberately distinct from `StalePricingBanner` — that answers "stored
 * prices no longer match what current dates would derive" (offers
 * Recalculate). This answers "the job no longer matches the document the
 * client is holding" (offers "Create the next quote version"). Both can be
 * true at once; they are not merged (finance-workflow-ux.md §2).
 */
export interface DriftSummary {
  linesChanged: number;
  servicesChanged: number;
  crewChanged: number;
  hasDrift: boolean;
}

export function summarizeDrift(rows: readonly DiffRow[]): DriftSummary {
  let linesChanged = 0;
  let servicesChanged = 0;
  let crewChanged = 0;
  for (const row of rows) {
    if (row.entityType === "group" || row.entityType === "lineItem" || row.entityType === "category") {
      linesChanged++;
    } else if (row.entityType === "service") {
      servicesChanged++;
    } else if (row.entityType === "crewAssignment") {
      crewChanged++;
    }
  }
  return {
    linesChanged,
    servicesChanged,
    crewChanged,
    hasDrift: linesChanged + servicesChanged + crewChanged > 0,
  };
}

/** A short human sentence for the drift banner — "3 lines changed, 1 service
 *  changed" — omitting any bucket that's zero (zero-noise, never "0 crew
 *  changes"). */
export function describeDrift(summary: DriftSummary): string {
  const parts: string[] = [];
  if (summary.linesChanged > 0) parts.push(`${summary.linesChanged} line${summary.linesChanged === 1 ? "" : "s"} changed`);
  if (summary.servicesChanged > 0) parts.push(`${summary.servicesChanged} service${summary.servicesChanged === 1 ? "" : "s"} changed`);
  if (summary.crewChanged > 0) parts.push(`${summary.crewChanged} crew change${summary.crewChanged === 1 ? "" : "s"}`);
  return parts.join(", ");
}
