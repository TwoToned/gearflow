/**
 * Deterministic collaboration user colours — Convex-side port of
 * src/lib/collaboration-colors.ts (getUserColor + COLLAB_COLORS). Convex can't
 * import from `@/lib`, so the pure hash is copied here and pinned byte-for-byte to
 * the src canonical by a cross-import equality test (convex/collaborationColors.test.ts).
 *
 * Browser-direct collaboration mutations recompute the actor colour from the
 * VERIFIED (resolveActor-pinned) userId rather than trusting a client-supplied
 * colour, so a caller can't attribute a comment under a spoofed avatar colour.
 */

// 12 distinct colours covering the hue wheel, skipping red and orange.
export const COLLAB_COLORS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#059669", // emerald
  "#65a30d", // lime
  "#d97706", // amber — warm but not error-red
  "#0d9488", // teal
  "#4f46e5", // indigo
  "#9333ea", // purple
  "#0284c7", // sky
  "#16a34a", // green
] as const;

/** Derive a stable colour hex from a user id string. Pure function, no random. */
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}
