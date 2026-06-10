"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Mira (AI assistant) context.
 *
 * A deliberately lightweight client provider that holds Mira's UI/session
 * state (open/closed, the page context handed to the assistant). It renders
 * its children synchronously so it can sit high in the tree without delaying
 * paint — the heavy assistant UI itself should be code-split where it's used.
 *
 * Note on loading strategy: the original spec suggested wrapping the app in a
 * `next/dynamic(..., { ssr: false })` boundary. That isn't viable here — it
 * would opt the whole app subtree out of SSR (blank initial paint) and isn't
 * allowed inside the async Server Component layout anyway. Keeping the provider
 * itself trivial achieves the same goal (no render-blocking) without that cost;
 * defer the actual Mira assistant chunk at its own mount point instead.
 */
interface MiraContextValue {
  /** Whether the Mira assistant panel is open. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Arbitrary page context handed to the assistant (route, entity, etc.). */
  pageContext: Record<string, unknown> | null;
  setPageContext: (ctx: Record<string, unknown> | null) => void;
}

const MiraContext = createContext<MiraContextValue | null>(null);

/** Access Mira state. Returns `null` when no provider is mounted. */
export function useMira(): MiraContextValue | null {
  return useContext(MiraContext);
}

export default function MiraContextProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<Record<string, unknown> | null>(null);

  const value = useMemo<MiraContextValue>(
    () => ({ open, setOpen, pageContext, setPageContext }),
    [open, pageContext],
  );

  return <MiraContext.Provider value={value}>{children}</MiraContext.Provider>;
}
