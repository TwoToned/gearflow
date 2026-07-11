"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";

const PREFIX = "gearflow-pref-";

function scopedKey(scope: string, key: string) {
  return `${PREFIX}${scope}-${key}`;
}

function read<T>(scope: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(scopedKey(scope, key));
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

  const [value, setValue] = useState<T>(() => read(scope, key, defaultValue));

  // Re-read when the scope changes (session resolves, or a different operator logs
  // in on the same device). Skip the very first run — state was already seeded from
  // the same scope — so we don't clobber an eager change made before this fires.
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
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
