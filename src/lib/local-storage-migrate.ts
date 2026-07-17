/**
 * Read a localStorage value, transparently migrating from a legacy (pre-rebrand)
 * key name to the current one.
 *
 * Rebrand transition helper: several UI-preference keys were prefixed `gearflow-`.
 * Renaming them to `rvlt-flow-` would silently reset every user's saved prefs. This
 * reads the new key first, and on a miss adopts the legacy value under the new key
 * (then clears the old one) so the preference survives the rename exactly once.
 *
 * Returns the raw stored string (caller parses), or null if neither key is set.
 */
export function readMigratedLocalStorage(
  newKey: string,
  legacyKey: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const current = window.localStorage.getItem(newKey);
    if (current !== null) return current;
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy !== null) {
      try {
        window.localStorage.setItem(newKey, legacy);
        window.localStorage.removeItem(legacyKey);
      } catch {
        // ignore quota / unavailable storage
      }
      return legacy;
    }
  } catch {
    // ignore malformed / unavailable storage
  }
  return null;
}
