/** A row a bulk verb did not touch, and why. Named in the toast, never silent. */
interface BulkSkip {
  name: string;
  why: string;
}

export interface BulkOutcome<R> {
  done: R[];
  skipped: BulkSkip[];
}

/**
 * Applies one write per selected row, in order. A per-row gate (`gate` returns
 * the reason to skip, or null) and a per-row failure both land in `skipped`, so
 * one bad row never aborts the rest and nothing is dropped without a name.
 * Sequential on purpose: each row is its own mutation and order is the order
 * the user saw.
 */
export async function runBulk<R>(
  rows: R[],
  opts: { name: (row: R) => string; gate?: (row: R) => string | null; apply: (row: R) => Promise<void> },
): Promise<BulkOutcome<R>> {
  const done: R[] = [];
  const skipped: BulkSkip[] = [];
  for (const row of rows) {
    const why = opts.gate?.(row) ?? null;
    if (why) {
      skipped.push({ name: opts.name(row), why });
      continue;
    }
    try {
      await opts.apply(row);
      done.push(row);
    } catch (e) {
      skipped.push({ name: opts.name(row), why: e instanceof Error ? e.message : "failed" });
    }
  }
  return { done, skipped };
}
