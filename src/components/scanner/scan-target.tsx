"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

/**
 * The shell's ScanTarget registry (6a).
 *
 * The phone bottom bar's Scan button is global chrome, but what a scan MEANS is
 * the page's call: on a warehouse job it should stage the item onto that job, not
 * navigate away. A page MAY register a handler with `useScanTarget(handler)`;
 * the shell then passes the decoded value to it and does nothing else. With no
 * handler registered, the shell falls back to the outside-a-job lookup
 * (`useScanLookup`: "Open asset ›" / not found / error / no permission).
 *
 * One handler at a time (the page in front): the latest registration wins, and
 * unregistering only clears it if it is still the registered one.
 */
export type ScanTargetHandler = (value: string) => void;

interface ScanTargetApi {
  register: (handler: ScanTargetHandler) => () => void;
  current: () => ScanTargetHandler | null;
}

const ScanTargetContext = createContext<ScanTargetApi | null>(null);

export function ScanTargetProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<ScanTargetHandler | null>(null);
  const api = useMemo<ScanTargetApi>(
    () => ({
      register: (handler) => {
        ref.current = handler;
        return () => {
          if (ref.current === handler) ref.current = null;
        };
      },
      current: () => ref.current,
    }),
    [],
  );
  return <ScanTargetContext.Provider value={api}>{children}</ScanTargetContext.Provider>;
}

/** A page registers its scan handler for as long as it is mounted. */
export function useScanTarget(handler: ScanTargetHandler): void {
  const api = useContext(ScanTargetContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => api?.register((value) => latest.current(value)), [api]);
}

/** The shell reads the registered handler at scan time (null = use the lookup). */
export function useScanTargetReader(): () => ScanTargetHandler | null {
  const api = useContext(ScanTargetContext);
  return () => api?.current() ?? null;
}
