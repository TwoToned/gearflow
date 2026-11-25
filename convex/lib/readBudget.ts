/**
 * A running allowance of documents ONE query may still read (Convex caps a query at 16,384). A list read
 * that fans out per row (members of each kit, reserved lines of each model) draws from ONE budget for the
 * whole call, so the total is bounded however many rows it covers. When it bites, the caller returns that
 * row's figure as `null` and sets `truncated`, rather than guessing or silently slicing.
 */
export class ReadBudget {
  truncated = false;
  constructor(public left: number) {}

  /** Reserve up to `want`; returns how many were granted (0 = spent). */
  take(want: number): number {
    const got = Math.max(0, Math.min(want, this.left));
    this.left -= got;
    if (got < want) this.truncated = true;
    return got;
  }

  /** True while at least one more document can be read. */
  get hasRoom(): boolean {
    return this.left > 0;
  }
}

/** No limit: for the single-row callers (a booking gate reads ONE kit). */
export const unlimitedBudget = (): ReadBudget => new ReadBudget(Number.POSITIVE_INFINITY);
