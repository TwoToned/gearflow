/**
 * The ⌘K palette's Recent refs (UX Phase 11, Q7): what the browser may keep in
 * localStorage (`src/lib/palette/recents.ts`) and what `paletteRecents.resolve`
 * accepts. Pure (no Convex imports) so both sides read ONE definition.
 */

/** Record types a Recent ref may name; each is resolved by its own org-checked loader. */
export const RECENT_TYPES = ["project", "asset", "kit", "model", "client", "crew", "supplier", "location"] as const;
export type RecentType = (typeof RECENT_TYPES)[number];

/** The palette shows five; the resolver refuses more (a hand-built call can't widen the read). */
export const MAX_RECENT_REFS = 5;

/** Ids are cuids; anything longer is junk (or an attempt to make the read expensive). */
export const MAX_RECENT_ID_LENGTH = 64;

export type RecentRef = { type: RecentType; id: string };

export function isRecentType(t: string): t is RecentType {
  return (RECENT_TYPES as readonly string[]).includes(t);
}
