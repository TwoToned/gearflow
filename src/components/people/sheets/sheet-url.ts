"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The URL is the state of a People create / edit sheet (UX Phase 13 slice 4), as for the Jobs and Assets
 * sheets: `?new=1` on a list opens a create sheet, `?edit=1` on a record opens its edit sheet, and an order
 * is created from its supplier with `?new-order=1`. A plain link opens one from anywhere; closing drops
 * the param and keeps the rest of the URL. The old `/new` and `/[id]/edit` routes only redirect here.
 */
export const NEW_PARAM = "new";
export const EDIT_PARAM = "edit";
export const NEW_ORDER_PARAM = "new-order";

const SHEET_PARAMS = [NEW_PARAM, EDIT_PARAM, NEW_ORDER_PARAM] as const;
type SheetParam = (typeof SHEET_PARAMS)[number];

/** Does this URL ask for the sheet, and how to close it (drops every sheet param, keeps the rest). */
export function useSheetParam(param: SheetParam): { open: boolean; close: () => void } {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.has(param);
  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    for (const p of SHEET_PARAMS) next.delete(p);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, params]);
  return { open, close };
}
