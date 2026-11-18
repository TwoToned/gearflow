"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  listParamKeys,
  parseListState,
  serializeListState,
  type ListUrlSpec,
  type ListUrlState,
} from "@/lib/list-url-state";

/** `push` makes Back work (segment/filter/sort/page); `replace` is for typing. */
export type UrlWriteMode = "push" | "replace";

/** The next URL: the list's own params replaced, any other param (`tab`) kept. */
export function listHref(pathname: string, current: URLSearchParams, state: ListUrlState, spec: ListUrlSpec): string {
  const next = new URLSearchParams(current.toString());
  for (const k of listParamKeys(spec)) next.delete(k);
  for (const [k, v] of serializeListState(state, spec)) next.set(k, v);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * A list page's state IS the URL (D11). Reads the codec from `useSearchParams`
 * (invalid params dropped) and writes through `router.push`/`replace`.
 * `spec` must be a module constant: it keys the memo.
 */
export function useListUrlState(spec: ListUrlSpec): {
  state: ListUrlState;
  setState: (next: ListUrlState, mode?: UrlWriteMode) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const state = useMemo(() => parseListState(new URLSearchParams(raw), spec), [raw, spec]);
  const setState = useCallback(
    (next: ListUrlState, mode: UrlWriteMode = "push") => {
      const href = listHref(pathname, new URLSearchParams(raw), next, spec);
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, raw, router, spec],
  );
  return { state, setState };
}
