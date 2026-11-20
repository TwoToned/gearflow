"use client";

import { useMemo } from "react";
import { useCurrentRole } from "@/lib/use-permissions";
import { visibleNav, type NavItem } from "@/lib/nav";

export interface NavItems {
  /** Every module the caller may see (gated rows and sub-rows already removed), Settings included. */
  all: NavItem[];
  /** Sidebar groups 0..2 (Settings excluded — it lives in the foot). */
  groups: NavItem[][];
  settings: NavItem | null;
  byKey: (key: string) => NavItem | undefined;
}

/**
 * The ONE place NAV is gated by the caller's role. The sidebar, rail, More sheet,
 * bottom bar and palette `@` pages all read this, so a gate can't be applied in
 * one surface and forgotten in another. Loading is permissive (no empty-nav flash).
 */
export function useNavItems(): NavItems {
  const { permissions } = useCurrentRole();
  return useMemo(() => {
    const all = visibleNav(permissions);
    const settings = all.find((i) => i.key === "settings") ?? null;
    const groups: NavItem[][] = [0, 1, 2].map((g) => all.filter((i) => i.group === g && i.key !== "settings"));
    return { all, groups, settings, byKey: (key) => all.find((i) => i.key === key) };
  }, [permissions]);
}
