/**
 * Optimistic-concurrency helpers for the collaboration substrate.
 *
 * Edit locks are advisory: they keep two users from editing the same target at
 * once, but a lock can expire (heartbeat missed, tab crashed) while an editor
 * still has stale form state open. The server-side revision check is the real
 * guard — it rejects a save when the record changed underneath the editor since
 * they opened it, regardless of lock state.
 *
 * The "revision" is just the record's `updatedAt`. The client captures it when
 * the editor opens (`baseUpdatedAt`) and sends it back on save; the server
 * compares it to the current `updatedAt`. Pure functions, no I/O — unit tested.
 */

export type RevisionInput = string | number | Date | null | undefined;

/**
 * Normalise a revision value (Date, epoch ms, or ISO string) to epoch ms.
 * Returns null when the value is missing or unparseable — callers treat null
 * as "unknown", which means the conflict check is skipped (fail-open) rather
 * than blocking a legitimate save on bad data.
 */
export function toRevisionMs(value: RevisionInput): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * True when the record changed since the editor's baseline — i.e. the current
 * revision is strictly newer than the baseline the editor opened with.
 *
 * Fail-open: if either side is unknown (null), we cannot prove staleness, so we
 * allow the save. This keeps the check from blocking saves when a client did
 * not send a baseline (older client, or a code path with no `updatedAt`).
 */
export function isStaleRevision(current: RevisionInput, base: RevisionInput): boolean {
  const c = toRevisionMs(current);
  const b = toRevisionMs(base);
  if (c == null || b == null) return false;
  return c > b;
}
