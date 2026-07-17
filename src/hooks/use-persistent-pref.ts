"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { readMigratedLocalStorage } from "@/lib/local-storage-migrate";

const PREFIX = "rvlt-flow-pref-";
// Rebrand transition: legacy prefix used before RVLT Flow. Migrated on first read
// so a user's saved prefs survive the rename instead of silently resetting.
const LEGACY_PREFIX = "gearflow-pref-";

function scopedKey(scope: string, key: string) {
  return `${PREFIX}${scope}-${key}`;
}

function read<T>(scope: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = readMigratedLocalStorage(
      scopedKey(scope, key),
      `${LEGACY_PREFIX}${scope}-${key}`,
    );
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // ignore malformed / unavailable storage
  }
  return fallback;
}

/**
 * Persist a small UI preference in localStorage, **scoped to the signed-in user**.
 *
 * Warehouses run shared devices — one tablet, many operators. The older
 * `use-table-preferences` keyed storage by table id alone, so operator A's density
 * or view choice leaked to operator B on the same device (flagged in eng review).
 * This hook namespaces every key by the session user id.
 *
 * Before the session resolves it uses an `"anon"` bucket, then re-reads the user's
 * stored value once their id is known (e.g. right after login on a shared device),
 * so a freshly signed-in operator sees *their* preference, not the last person's.
 */
export function usePersistentPref<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const { data: session } = useSession();
  const scope = session?.user?.id ?? "anon";

  // Initialise to the default so the server and the first client render agree — a
  // localStorage read in the initializer would diverge from SSR and throw a
  // hydration mismatch. The effect below syncs the stored value in right after mount.
  const [value, setValue] = useState<T>(defaultValue);

  // Read the stored value on mount AND whenever the scope or the key changes: scope
  // change = a different operator on a shared device; key change = the same component
  // instance being reused for a different table (both must re-read, or one table's
  // choice bleeds into another's).
  useEffect(() => {
    setValue(read(scope, key, defaultValue));
    // defaultValue is intentionally excluded: callers pass literals, and re-reading
    // on identity churn would fight a user's in-session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (typeof window === "undefined") return;
      try {
        localStorage.setItem(scopedKey(scope, key), JSON.stringify(next));
      } catch {
        // ignore quota / unavailable storage
      }
    },
    [scope, key],
  );

  return [value, set];
}
