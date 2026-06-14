/**
 * Reusable target descriptors for the collaboration substrate (edit locks,
 * presence, comment threads, review markers). The lock/comment tables are
 * generic over a `(targetType, targetId)` string pair — these helpers keep the
 * conventions in one place so section-level project locks, group comments, and
 * line-item locks all agree on the same `targetType` strings.
 *
 * Pure — no Convex / React imports, so it's safe to use on the server (gates)
 * and unit-test directly.
 */

export interface CollabTarget {
  targetType: string;
  targetId: string;
}

/** targetType strings used across project equipment collaboration. */
export const COLLAB_TARGET_TYPES = {
  lineItem: "lineItem",
  group: "group",
  category: "category",
} as const;

export function lineItemTarget(lineItemId: string): CollabTarget {
  return { targetType: COLLAB_TARGET_TYPES.lineItem, targetId: lineItemId };
}

/** A project equipment group (ProjectGroup). */
export function groupTarget(groupId: string): CollabTarget {
  return { targetType: COLLAB_TARGET_TYPES.group, targetId: groupId };
}

/** A project equipment category / section. */
export function categoryTarget(categoryId: string): CollabTarget {
  return { targetType: COLLAB_TARGET_TYPES.category, targetId: categoryId };
}

/**
 * Stable key for a lock/comment map keyed by target. Equipment views subscribe
 * to all locks on the project once (listLocksForEntity) and look rows up by this
 * key instead of mounting a hook per row.
 */
export function targetKey(target: { targetType?: string | null; targetId?: string | null }): string {
  return `${target.targetType ?? ""}:${target.targetId ?? ""}`;
}
