"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { financeViewQuery, parseFinanceView, type FinanceView } from "@/lib/finance-view";

/** The Finance tab's Quotes / Invoices words-switch; the URL (`?fin=`) is its only state. */
export function useFinanceView(): [FinanceView, (view: FinanceView) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = parseFinanceView(params.get("fin"));
  const setView = useCallback(
    (next: FinanceView) => router.replace(`${pathname}?${financeViewQuery(params, next)}`, { scroll: false }),
    [params, pathname, router],
  );
  return [view, setView];
}
