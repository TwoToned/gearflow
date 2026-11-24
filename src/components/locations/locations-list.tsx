"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../convex/_generated/api";
import { BinLabelsDialog, type BinLabel } from "@/components/locations/bin-labels-dialog";
import { MoveContentsDialog, type MoveSource } from "@/components/locations/move-contents-dialog";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  LOCATIONS_SPEC,
  LOCATION_COLUMNS,
  LOCATION_ITEM_HEADER,
  LOCATION_ITEM_SORT_KEY,
  locationFilters,
  locationRowOf,
  locationSegments,
  locationsQueryArgs,
  type LocationSource,
} from "@/lib/list-views/locations";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import { buildLocationActions, buildLocationBulkActions } from "@/lib/row-actions/location";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";
import { toast } from "sonner";

/** Keyed by org: the seen-row cache and the selection never leak across an org switch. */
export function LocationsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <LocationsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

/** `Moved 4 items to Van 2 · skipped 2: out on a job`. */
function moveTitle(moved: number, toName: string, skipped: { reason: string; count: number }[]): string {
  const base = `Moved ${plural(moved, "item")} to ${toName}`;
  if (skipped.length === 0) return base;
  const n = skipped.reduce((s, x) => s + x.count, 0);
  return `${base} · skipped ${n} (${skipped.map((s) => `${s.count} ${s.reason}`).join(", ")})`;
}

function LocationsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const { state, setState } = useListUrlState(LOCATIONS_SPEC);
  const canCreate = useCanDo("location", "create");
  const canUpdate = useCanDo("location", "update");
  const canDelete = useCanDo("location", "delete");
  const canAsset = useCanDo("asset", "update");
  const canBulk = useCanDo("bulkAsset", "update");
  const canKit = useCanDo("kit", "update");
  // Moving contents writes assets, bulk lines and kits as well as locations: all four are needed.
  const canMove = canUpdate && canAsset && canBulk && canKit;
  const writes = useLocationWrites();
  const tags = useOrgTags(orgId);
  const allLocations = useLocations(orgId);

  const page = useAuthedQuery(api.locationsList.listPage, orgId ? { orgId, ...locationsQueryArgs(state) } : "skip");
  const counts = useAuthedQuery(api.locationsList.segmentCounts, orgId ? { orgId } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: LocationSource[]; total: number; totalPages: number } | undefined);

  // Phone pages accumulate: handlers read the row at click time, from every row seen so far.
  const seen = React.useRef(new Map<string, LocationSource>());
  React.useEffect(() => {
    for (const l of items) seen.current.set(l.id, l);
  }, [items]);

  const [moveFrom, setMoveFrom] = React.useState<MoveSource[] | null>(null);
  const [labels, setLabels] = React.useState<BinLabel[] | null>(null);
  const sourcesFor = (ids: string[]): MoveSource[] => ids.flatMap((id) => (seen.current.get(id) ? [{ id, name: seen.current.get(id)!.name, stored: seen.current.get(id)!.stored }] : []));
  const labelsFor = (ids: string[]): BinLabel[] => ids.flatMap((id) => (seen.current.get(id) ? [{ id, name: seen.current.get(id)!.name, printed: seen.current.get(id)!.labelState === "printed" }] : []));

  useKeyboardShortcut("n", () => canCreate && router.push("/locations/new"));

  /** ONE guarded Undo closure per move (`announceListWrite`); the server leaves any row that moved on since. */
  const move = async (toId: string) => {
    const fromIds = (moveFrom ?? []).map((s) => s.id);
    const toName = allLocations?.find((l) => l.id === toId)?.name ?? "the new location";
    try {
      const r = await writes.moveContents(fromIds, toId);
      announceListWrite({
        title: moveTitle(r.moved, toName, r.skipped),
        undoneTitle: "Moved back",
        performUndo: async () => {
          const u = await writes.undoMoveContents(r.auditId);
          return u.left > 0 ? `Put back ${plural(u.restored, "item")} · ${u.left} had moved on and stay where they are` : undefined;
        },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not move the contents" });
      throw e;
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await writes.remove(id);
      toast.success(`Deleted ${name}`);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not delete the location" });
    }
  };

  const rows = items.map((l) =>
    locationRowOf(
      l,
      buildLocationActions({
        title: l.name,
        onOpen: () => router.push(`/locations/${l.id}`),
        onEdit: canUpdate ? () => router.push(`/locations/${l.id}/edit`) : undefined,
        onMoveContents: canMove ? () => setMoveFrom(sourcesFor([l.id])) : undefined,
        onPrintLabel: canUpdate ? () => setLabels(labelsFor([l.id])) : undefined,
        onDelete: canDelete ? () => void remove(l.id, l.name) : undefined,
      }),
    ),
  );
  const primary: ListPrimary | undefined = canCreate ? { label: "New location", onSelect: () => router.push("/locations/new") } : undefined;

  return (
    <>
      <ListPage
        spec={LOCATIONS_SPEC}
        title="Locations"
        noun="locations"
        bulkNoun="location"
        searchPlaceholder="Search name or address"
        segments={locationSegments(counts as Record<string, number> | undefined)}
        filters={locationFilters(tags)}
        columns={LOCATION_COLUMNS}
        columnsKey="locations"
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={LOCATION_ITEM_HEADER}
        itemSortKey={LOCATION_ITEM_SORT_KEY}
        primary={primary}
        bulk={(ids) =>
          buildLocationBulkActions({
            onMoveContents: canMove ? () => setMoveFrom(sourcesFor(ids)) : undefined,
            onPrintLabels: canUpdate ? () => setLabels(labelsFor(ids)) : undefined,
          })
        }
        empty={{ title: "No locations yet", description: "Warehouses, vehicles, venues and the bins inside them.", action: primary }}
        toolbarExtra={<UrlSavedViewsMenu tableId="locations" spec={LOCATIONS_SPEC} state={state} setState={setState} />}
      />
      <MoveContentsDialog
        sources={moveFrom}
        destinations={(allLocations ?? []).map((l) => ({ id: l.id, name: l.name }))}
        onClose={() => setMoveFrom(null)}
        onMove={move}
      />
      <BinLabelsDialog
        labels={labels}
        origin={typeof window === "undefined" ? "" : window.location.origin}
        onClose={() => setLabels(null)}
        onPrinted={async (ids) => {
          if (ids.length === 0) return;
          try {
            await writes.setLabelsPrinted(ids);
            toast.success(`Printed ${plural(ids.length, "bin label")}`);
          } catch (e) {
            showError(e, { fallbackTitle: "Could not record the print" });
          }
        }}
      />
    </>
  );
}
