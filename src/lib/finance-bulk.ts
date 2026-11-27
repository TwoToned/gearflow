import { listWriteTitle, plural } from "@/lib/list-write-toast";

/**
 * A Finance hub bulk verb (UX Phase 17): run an EXISTING per-row write over the ticked rows. Each row is
 * checked for eligibility from its derived facts (so the toast can NAME what was skipped and why), then
 * written by the existing mutation, which enforces its OWN gate server-side (a row the caller may not
 * touch comes back as a skip, never a whole-call failure). Capped at 50 rows. None of the writes has an
 * exact reverse (accept, void, delete, acknowledge: documented no-Undo), so a bulk run offers no Undo and
 * its toast is the one announcement.
 */
export const MAX_FINANCE_BULK = 50;

export interface BulkRow {
  id: string;
  /** What the toast calls it: `INV-0041`, `#2341 v3`. */
  name: string;
}

export interface BulkOutcome {
  done: number;
  skipped: { name: string; why: string }[];
}

export function bulkCapMessage(count: number): string | null {
  return count > MAX_FINANCE_BULK ? `Select at most ${MAX_FINANCE_BULK} at a time (you have ${count}).` : null;
}

/**
 * `eligible` says why a row can't take the verb (or null); `run` is the existing write for one row and may
 * throw (its message becomes that row's skip reason). Rows run one after another so a failure is attributable.
 */
export async function runBulk<R extends BulkRow>(
  rows: R[],
  eligible: (row: R) => string | null,
  run: (row: R) => Promise<void>,
): Promise<BulkOutcome> {
  const out: BulkOutcome = { done: 0, skipped: [] };
  for (const row of rows.slice(0, MAX_FINANCE_BULK)) {
    const why = eligible(row);
    if (why) {
      out.skipped.push({ name: row.name, why });
      continue;
    }
    try {
      await run(row);
      out.done += 1;
    } catch (e) {
      out.skipped.push({ name: row.name, why: e instanceof Error ? e.message : "Couldn't be done" });
    }
  }
  return out;
}

/** `Deleted 3 drafts · skipped INV-0041, INV-0042: only a draft can be deleted`, or `Nothing changed · ...`. */
export function bulkToastTitle(verb: string, noun: string, o: BulkOutcome): string {
  if (o.done === 0 && o.skipped.length > 0) return `Nothing changed · ${o.skipped[0].name}: ${o.skipped[0].why}`;
  return listWriteTitle(`${verb} ${plural(o.done, noun)}`, o.skipped);
}
