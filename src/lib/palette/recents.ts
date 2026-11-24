import { z } from "zod";
import {
  MAX_RECENT_ID_LENGTH,
  MAX_RECENT_REFS,
  RECENT_TYPES,
  type RecentRef,
} from "../../../convex/lib/paletteRecentRefs";

/**
 * The ⌘K palette's Recent list (UX Phase 11, §6d.3, decision Q7): the last five
 * rows opened, as `{ type, id }` refs ONLY — no names at rest — in localStorage
 * keyed per (org, user). Another org's (or another user's) list is a different
 * key, so it is never read; `paletteRecents.resolve` org- and role-checks every
 * ref on the way back anyway. Storage can throw (private mode, blocked site
 * data): every access is wrapped, and the palette simply has no Recent group.
 */

const STORAGE_PREFIX = "gf:palette-recents:v1";

const RefsSchema = z
  .array(z.object({ type: z.enum(RECENT_TYPES), id: z.string().min(1).max(MAX_RECENT_ID_LENGTH) }))
  .max(50);

export function recentsKey(orgId: string, userId: string): string {
  return `${STORAGE_PREFIX}:${orgId}:${userId}`;
}

/** Opening a row moves it to the top; no duplicates; at most five. */
export function pushRecent(list: readonly RecentRef[], ref: RecentRef): RecentRef[] {
  const rest = list.filter((r) => !(r.type === ref.type && r.id === ref.id));
  return [ref, ...rest].slice(0, MAX_RECENT_REFS);
}

/** Parse what storage held (a trust boundary: it may be junk, old or hand-edited). */
export function parseRecents(raw: string | null): RecentRef[] {
  if (!raw) return [];
  try {
    const parsed = RefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, MAX_RECENT_REFS) : [];
  } catch {
    return [];
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecents(orgId: string, userId: string, store: StorageLike | null = storage()): RecentRef[] {
  try {
    return parseRecents(store?.getItem(recentsKey(orgId, userId)) ?? null);
  } catch {
    return [];
  }
}

export function writeRecents(orgId: string, userId: string, refs: readonly RecentRef[], store: StorageLike | null = storage()): void {
  try {
    store?.setItem(recentsKey(orgId, userId), JSON.stringify(refs.slice(0, MAX_RECENT_REFS)));
  } catch {
    // Storage full or blocked: Recent is a convenience, never a reason to fail a navigation.
  }
}
