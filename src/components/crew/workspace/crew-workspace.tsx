"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings2, Users } from "lucide-react";

import { CrewRolesSheet } from "@/components/crew/workspace/roles/crew-roles-sheet";
import { ListHead, type HeadWords, type ListPrimary } from "@/components/ui/list-page-parts";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The Crew workspace (UX Phase 15, spec §9h.2, D48): ONE page `Crew` with two
 * views as head words, `Planner  Timesheets`, each its own route so
 * `/crew/planner` and `/crew/timesheets` stay deep links. The page ⋯ carries
 * `Crew list` and `Crew roles & rates…` in both views; the roles sheet is URL
 * state (`?sheet=roles`, where `/crew/settings` now redirects).
 */
export type CrewView = "planner" | "timesheets";

const CREW_VIEW_HREF: Record<CrewView, string> = {
  planner: "/crew/planner",
  timesheets: "/crew/timesheets",
};

function crewHeadWords(view: CrewView): HeadWords {
  return {
    value: view,
    words: [
      { key: "planner", label: "Planner", href: CREW_VIEW_HREF.planner },
      { key: "timesheets", label: "Timesheets", href: CREW_VIEW_HREF.timesheets },
    ],
  };
}

/** `?sheet=roles` opens Crew roles & rates; closing drops the param (other params kept). */
const SHEET_PARAM = "sheet";
const ROLES_SHEET = "roles";

function useRolesSheetParam() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const open = params.get(SHEET_PARAM) === ROLES_SHEET;
  const setOpen = (next: boolean) => {
    const p = new URLSearchParams(params.toString());
    if (next) p.set(SHEET_PARAM, ROLES_SHEET);
    else p.delete(SHEET_PARAM);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return { open, setOpen };
}

/** The page ⋯ items both views share (§9h.2). */
function sharedMenuItems(push: (href: string) => void, openRoles: () => void): ActionItem[] {
  return [
    { key: "crew-list", label: "Crew list", group: "organise", icon: Users, onSelect: () => push("/crew") },
    { key: "roles", label: "Crew roles & rates…", group: "organise", icon: Settings2, onSelect: openRoles },
  ];
}

/**
 * What a Crew view needs from the workspace: its head words, the shared ⋯
 * items, and the roles sheet element to mount once.
 */
export function useCrewWorkspace(view: CrewView) {
  const router = useRouter();
  const roles = useRolesSheetParam();
  return {
    headWords: crewHeadWords(view),
    menuItems: sharedMenuItems(router.push, () => roles.setOpen(true)),
    rolesSheet: <CrewRolesSheet open={roles.open} onOpenChange={roles.setOpen} />,
  };
}

/**
 * The head for a Crew view that is not a ListPage (the planner, until its own
 * rebuild in slice 3): title `Crew`, the view words, the page ⋯, the primary.
 */
export function CrewWorkspaceHead({
  view,
  primary,
  extraMenu,
}: {
  view: CrewView;
  primary?: ListPrimary;
  extraMenu?: ActionItem[];
}) {
  const ws = useCrewWorkspace(view);
  const pageMenu: ActionMenuSpec = { items: [...ws.menuItems, ...(extraMenu ?? [])] };
  return (
    <>
      <ListHead title="Crew" headWords={ws.headWords} pageMenu={pageMenu} primary={primary} />
      {ws.rolesSheet}
    </>
  );
}
