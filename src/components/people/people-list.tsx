"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ListPage, type ListPageProps } from "@/components/ui/list-page";
import { PEOPLE_LISTS, type PeopleListKey } from "@/lib/list-views/people";
import type { ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The ONE People list renderer (UX Phase 13, spec §9f.3): Crew, Clients and Suppliers
 * are three configs handed to this component, which is `ListPage` plus the one thing
 * they share and Jobs does not, the `People ▾` switcher. Strip, filter words, table,
 * cards, pager, bulk bar, selection and URL state are all `ListPage`'s. A config is
 * a `ListPageProps` object built by `useCrewListModel` / `useClientListModel` /
 * `useSupplierListModel`; nothing list-specific lives here.
 */
export type PeopleListModel = Omit<ListPageProps, "titleMenu"> & { key: PeopleListKey };

/** The phone title's sheet: the OTHER two People lists (the current one is the page). */
export function peopleSwitchMenu(current: PeopleListKey, push: (href: string) => void): ActionMenuSpec {
  return {
    items: PEOPLE_LISTS.filter((l) => l.key !== current).map((l) => ({
      key: l.key,
      label: l.label,
      group: "organise" as const,
      onSelect: () => push(l.href),
    })),
  };
}

export function PeopleList({ model, children }: { model: PeopleListModel; children?: React.ReactNode }) {
  const router = useRouter();
  const { key, ...props } = model;
  return (
    <>
      <ListPage {...props} titleMenu={peopleSwitchMenu(key, router.push)} />
      {children}
    </>
  );
}
