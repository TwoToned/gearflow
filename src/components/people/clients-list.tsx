"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../convex/_generated/api";

import { PeopleList, type PeopleListModel } from "@/components/people/people-list";
import { useClientListWrites } from "@/components/people/use-people-writes";
import { TagPromptDialog } from "@/components/ui/tag-prompt-dialog";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  CLIENTS_SPEC,
  CLIENT_ITEM_HEADER,
  CLIENT_ITEM_SORT_KEY,
  clientColumns,
  clientFilters,
  clientQueryArgs,
  clientRowOf,
  clientSegments,
  clientSubline,
  markTruncated,
  clientsBuiltInViews,
  type ClientSource,
} from "@/lib/list-views/people";
import { clientActions, clientBulkActions } from "@/lib/row-actions/people";
import { useCanDo } from "@/lib/use-permissions";
import { newJobForClientHref } from "@/lib/new-job-url";

/** Clients list (spec §9f.2): the four stat tiles are strip counts, a sub line and the Type filter. */
export function ClientsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <ClientsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function ClientsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(CLIENTS_SPEC);
  const canCreate = useCanDo("client", "create");
  const canUpdate = useCanDo("client", "update");
  const canCreateJob = useCanDo("project", "create");
  const page = useAuthedQuery(api.peopleLists.clientPage, orgId ? { orgId, ...clientQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.peopleLists.clientSegmentCounts, orgId ? { orgId, now } : "skip");
  const items = React.useMemo(() => (page?.items ?? []) as unknown as ClientSource[], [page]);

  const seen = React.useRef(new Map<string, ClientSource>());
  React.useEffect(() => {
    for (const c of items) seen.current.set(c.id, c);
  }, [items]);
  const w = useClientListWrites(orgId, seen);
  const [tagIds, setTagIds] = React.useState<string[] | null>(null);
  const moneyVisible = page?.moneyVisible === true;

  const rows = items.map((c) => {
    const first = c.openJobs[0];
    const menu = clientActions(
      { name: c.name, isActive: c.isActive, firstOpenJob: first ?? null, xeroLinked: c.xeroLinked },
      {
        onOpen: () => router.push(`/clients/${c.id}`),
        onOpenJob: first ? () => router.push(`/projects/${first.id}`) : undefined,
        onNewJob: canCreateJob ? () => router.push(newJobForClientHref(c.id)) : undefined,
        onOpenInvoices: moneyVisible ? () => router.push("/finance") : undefined,
        onOpenInXero: c.xeroContactId ? () => window.open(`https://go.xero.com/Contacts/View/${encodeURIComponent(c.xeroContactId!)}`, "_blank", "noopener") : undefined,
        onAddTag: canUpdate ? () => setTagIds([c.id]) : undefined,
        onArchive: canUpdate ? () => void w.archiveOne(c.id) : undefined,
        onReactivate: canUpdate ? () => void w.reactivateOne(c.id) : undefined,
      },
    );
    return clientRowOf(c, menu);
  });

  const create = canCreate ? { label: "New client", onSelect: () => router.push("/clients?new=1") } : undefined;
  const model: PeopleListModel = {
    key: "clients",
    spec: CLIENTS_SPEC,
    title: "Clients",
    noun: "clients",
    bulkNoun: "client",
    searchPlaceholder: "Search client, contact or tag",
    segments: clientSegments(counts as Record<string, number | null> | undefined, moneyVisible),
    filters: clientFilters(),
    columnsKey: "clients",
    columns: clientColumns(moneyVisible),
    rows,
    total: page?.total ?? 0,
    loading: page === undefined,
    itemHeader: CLIENT_ITEM_HEADER,
    itemSortKey: CLIENT_ITEM_SORT_KEY,
    subline: clientSubline(markTruncated(counts, page) as Parameters<typeof clientSubline>[0]),
    primary: create,
    bulk: (ids) =>
      clientBulkActions({
        onAddTag: canUpdate ? () => setTagIds(ids) : undefined,
        onExport: () => w.bulkExport(ids),
        onArchive: canUpdate ? () => void w.bulkArchive(ids) : undefined,
      }),
    empty: { title: "No clients yet", description: "Companies, venues and people you hire to appear here.", action: create },
    toolbarExtra: <UrlSavedViewsMenu tableId="clients" spec={CLIENTS_SPEC} state={state} setState={setState} builtIns={clientsBuiltInViews(moneyVisible)} />,
  };

  return (
    <PeopleList model={model}>
      <TagPromptDialog open={tagIds !== null} onOpenChange={(o) => !o && setTagIds(null)} count={tagIds?.length ?? 0} noun="client" onSubmit={(tag) => tagIds && void w.bulkTag(tagIds, tag)} />
    </PeopleList>
  );
}
