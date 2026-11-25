"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../convex/_generated/api";

import { PeopleList, type PeopleListModel } from "@/components/people/people-list";
import { useSupplierListWrites } from "@/components/people/use-people-writes";
import { TagPromptDialog } from "@/components/ui/tag-prompt-dialog";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  SUPPLIERS_SPEC,
  SUPPLIER_ITEM_HEADER,
  SUPPLIER_ITEM_SORT_KEY,
  supplierColumns,
  supplierQueryArgs,
  supplierRowOf,
  supplierSegments,
  supplierSubline,
  markTruncated,
  type SupplierSource,
} from "@/lib/list-views/people";
import { supplierActions, supplierBulkActions, when } from "@/lib/row-actions/people";
import { useCanDo } from "@/lib/use-permissions";

/** Suppliers list (spec §9f.2): the four tiles are strip counts and a sub line. `On hire` / `Due back` arrive with the order return date (slice 2). */
export function SuppliersList() {
  const { data: activeOrg } = useActiveOrganization();
  return <SuppliersListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function SuppliersListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(SUPPLIERS_SPEC);
  const canCreate = useCanDo("supplier", "create");
  const canUpdate = useCanDo("supplier", "update");
  useKeyboardShortcut("n", () => canCreate && router.push("/suppliers/new"));
  const page = useAuthedQuery(api.peopleLists.supplierPage, orgId ? { orgId, ...supplierQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.peopleLists.supplierSegmentCounts, orgId ? { orgId, now } : "skip") as Record<string, number> | undefined;
  const items = React.useMemo(() => (page?.items ?? []) as unknown as SupplierSource[], [page]);

  const seen = React.useRef(new Map<string, SupplierSource>());
  React.useEffect(() => {
    for (const s of items) seen.current.set(s.id, s);
  }, [items]);
  const w = useSupplierListWrites(orgId, seen);
  const [tagIds, setTagIds] = React.useState<string[] | null>(null);
  const moneyVisible = page?.moneyVisible === true;

  const goNew = () => router.push("/suppliers/new");
  const rows = items.map((s) =>
    supplierRowOf(
      s,
      supplierActions(
        { name: s.name, isActive: s.isActive, email: s.email },
        {
          onOpen: () => router.push(`/suppliers/${s.id}`),
          onOrders: () => router.push(`/suppliers/${s.id}`),
          onNewOrder: when(canCreate, () => router.push(`/suppliers/${s.id}/orders/new`)),
          onEmail: () => { window.location.href = `mailto:${s.email ?? ""}`; },
          onAddTag: when(canUpdate, () => setTagIds([s.id])),
          onArchive: when(canUpdate, () => void w.bulkArchive([s.id])),
          onReactivate: when(canUpdate, () => void w.reactivateOne(s.id)),
        },
      ),
    ),
  );

  const create = canCreate ? { label: "New supplier", onSelect: goNew } : undefined;
  const model: PeopleListModel = {
    key: "suppliers",
    spec: SUPPLIERS_SPEC,
    title: "Suppliers",
    noun: "suppliers",
    bulkNoun: "supplier",
    searchPlaceholder: "Search supplier, contact or account #",
    segments: supplierSegments(counts),
    filters: [],
    columnsKey: "suppliers",
    columns: supplierColumns(moneyVisible),
    rows,
    total: page?.total ?? 0,
    loading: page === undefined,
    itemHeader: SUPPLIER_ITEM_HEADER,
    itemSortKey: SUPPLIER_ITEM_SORT_KEY,
    subline: supplierSubline(markTruncated(counts, page)),
    primary: create,
    bulk: (ids) =>
      supplierBulkActions({
        onExport: () => w.bulkExport(ids),
        onAddTag: when(canUpdate, () => setTagIds(ids)),
        onArchive: when(canUpdate, () => void w.bulkArchive(ids)),
      }),
    empty: { title: "No suppliers yet", description: "Vendors you buy from or sub-hire from appear here.", action: create },
    toolbarExtra: <UrlSavedViewsMenu tableId="suppliers" spec={SUPPLIERS_SPEC} state={state} setState={setState} />,
  };

  return (
    <PeopleList model={model}>
      <TagPromptDialog open={tagIds !== null} onOpenChange={(o) => !o && setTagIds(null)} count={tagIds?.length ?? 0} noun="supplier" onSubmit={(tag) => tagIds && void w.bulkTag(tagIds, tag)} />
    </PeopleList>
  );
}
