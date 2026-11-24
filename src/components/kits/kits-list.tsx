"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useStableNow } from "@/hooks/use-stable-now";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { toCsv } from "@/lib/csv";
import {
  KITS_SPEC,
  KIT_COLUMNS,
  KIT_ITEM_HEADER,
  KIT_ITEM_SORT_KEY,
  kitFilters,
  kitRowOf,
  kitSegments,
  kitsQueryArgs,
  type KitSource,
} from "@/lib/list-views/kits";
import { plural } from "@/lib/list-write-toast";
import { buildKitActions, buildKitBulkActions } from "@/lib/row-actions/kit";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";

/** Keyed by org: the seen-row cache and the selection never leak across an org switch. */
export function KitsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <KitsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function KitsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(KITS_SPEC);
  const canCreate = useCanDo("kit", "create");
  const canUpdate = useCanDo("kit", "update");
  const canCheckIn = useCanDo("warehouse", "check_in");
  const warehouse = useWarehouseWrites();
  const tags = useOrgTags(orgId);
  const categories = useCategories(orgId);
  const locations = useLocations(orgId);

  const page = useAuthedQuery(api.kitsList.listPage, orgId ? { orgId, ...kitsQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.kitsList.segmentCounts, orgId ? { orgId, now } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: KitSource[]; total: number; totalPages: number } | undefined);

  // Phone pages accumulate: handlers read the row at click time, from every row seen so far.
  const seen = React.useRef(new Map<string, KitSource>());
  React.useEffect(() => {
    for (const k of items) seen.current.set(k.id, k);
  }, [items]);

  const forceReturn = async (ids: string[]) => {
    try {
      const out = ids.filter((id) => seen.current.get(id)?.state.key === "CHECKED_OUT");
      const r = await warehouse.forceReturnKits(out);
      toast.success(`Force returned ${plural(r.count, "kit")} to available${ids.length > out.length ? ` · ${ids.length - out.length} not out, left as they are` : ""}`);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not force return" });
    }
  };

  /** Print only: the selected kits as a CSV list (tag, name, state, items, location). */
  const printList = (ids: string[]) => {
    const rows = ids.flatMap((id) => {
      const k = seen.current.get(id);
      return k ? [[k.assetTag, k.name, k.state.key, String(k.itemCount), k.location?.name ?? ""]] : [];
    });
    downloadCsv(toCsv(["Tag", "Name", "State", "Items", "Location"], rows), "kits.csv");
  };

  useKeyboardShortcut("n", () => canCreate && router.push("/kits/new"));

  const rows = items.map((k) =>
    kitRowOf(
      k,
      buildKitActions(k.assetTag, {
        onOpen: () => router.push(`/kits/${k.id}`),
        onEdit: canUpdate ? () => router.push(`/kits/${k.id}/edit`) : undefined,
        onForceReturn: canCheckIn && k.state.key === "CHECKED_OUT" ? () => void forceReturn([k.id]) : undefined,
      }),
    ),
  );
  const photos = React.useMemo(() => new Map(items.map((k) => [k.id, k.media])), [items]);
  const primary: ListPrimary | undefined = canCreate ? { label: "New kit", onSelect: () => router.push("/kits/new") } : undefined;

  return (
    <ListPage
      spec={KITS_SPEC}
      title="Kits"
      noun="kits"
      bulkNoun="kit"
      searchPlaceholder="Search tag, name or description"
      segments={kitSegments(counts as Record<string, number> | undefined)}
      filters={kitFilters((categories ?? []).map((c) => ({ id: c.id, name: c.name })), (locations ?? []).map((l) => ({ id: l.id, name: l.name })), tags)}
      columns={KIT_COLUMNS}
      columnsKey="kits"
      rows={rows}
      total={total}
      loading={isLoading}
      itemHeader={KIT_ITEM_HEADER}
      itemSortKey={KIT_ITEM_SORT_KEY}
      leading={(row) => <MediaThumbnail url={photos.get(row.id)?.url} thumbnailUrl={photos.get(row.id)?.thumbnailUrl} alt={row.title} size={32} />}
      primary={primary}
      bulk={(ids) => {
        const out = ids.filter((id) => seen.current.get(id)?.state.key === "CHECKED_OUT");
        return buildKitBulkActions({
          onPrintList: () => printList(ids),
          forceReturnCount: out.length,
          onForceReturn: canCheckIn ? () => void forceReturn(ids) : undefined,
        });
      }}
      empty={{ title: "No kits yet", description: "Bundle gear that always travels together. Create your first kit with New kit.", action: primary }}
      toolbarExtra={<UrlSavedViewsMenu tableId="kits" spec={KITS_SPEC} state={state} setState={setState} />}
    />
  );
}
