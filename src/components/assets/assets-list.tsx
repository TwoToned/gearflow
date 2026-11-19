"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConvex, useConvexAuth } from "convex/react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { AssetGallery } from "@/components/assets/asset-gallery";
import { BulkAddTagsDialog, BulkEditDialog } from "@/components/assets/bulk-asset-dialogs";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ListPage } from "@/components/ui/list-page";
import type { ListFilterDef, ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { StatusWord } from "@/components/ui/status-word";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useLocations } from "@/hooks/use-locations";
import { useModels } from "@/hooks/use-models";
import { useOrgTags } from "@/hooks/use-org-tags";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useServerQuery } from "@/hooks/use-server-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { runBulk } from "@/lib/bulk-run";
import {
  ASSET_ITEM_HEADER,
  ASSET_ITEM_SORT_KEY,
  ASSETS_SPEC,
  BULK_COLUMNS,
  SERIALIZED_COLUMNS,
  assetFilters,
  assetRowOf,
  assetSegments,
  assetsQueryArgs,
  bulkQueryArgs,
  exportFilename,
  kindOf,
  serializedQueryArgs,
  type AssetExtras,
  type AssetKind,
  type AssetSource,
} from "@/lib/list-views/assets";
import { withPatch, type ListUrlState } from "@/lib/list-url-state";
import { plural } from "@/lib/list-write-toast";
import type { ActionMenuSpec, LineRowData } from "@/lib/primitives/types";
import { buildAssetActions, buildAssetBulkActions } from "@/lib/row-actions/asset";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";
import { exportAssetsCSV, exportBulkAssetsCSV } from "@/server/csv";

const VIEW_STORAGE_KEY = "assets-view-mode";

interface Thumb {
  url?: string | null;
  thumbnailUrl?: string | null;
}

/** Table is the default (D12); a remembered Grid choice is restored once, when the URL names no view. */
function useRememberedView(state: ListUrlState, setState: (s: ListUrlState, m?: "push" | "replace") => void) {
  const latest = React.useRef({ state, setState });
  React.useEffect(() => {
    latest.current = { state, setState };
  });
  React.useEffect(() => {
    try {
      const { state: s, setState: set } = latest.current;
      if (!s.view && window.localStorage.getItem(VIEW_STORAGE_KEY) === "grid") set(withPatch(s, { view: "grid" }), "replace");
    } catch {
      /* storage blocked: stay on Table */
    }
  }, []);
  React.useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, state.view === "grid" ? "grid" : "table");
    } catch {
      /* ignore */
    }
  }, [state.view]);
}

function usePhotos(orgId: string | undefined) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data } = useServerQuery({
    queryKey: ["asset-registry-photos", orgId, isAuthenticated],
    queryFn: () => convex.query(api.assets.registryPhotos, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });
  return data as { assetPhotos?: Record<string, Thumb>; modelPhotos?: Record<string, Thumb> } | undefined;
}

/** One page of either kind, plus the serialised-only derived columns for that page. */
function useAssetsPage(orgId: string | undefined, state: ListUrlState, now: number, kind: AssetKind) {
  const common = assetsQueryArgs(state);
  const serialized = useAuthedQuery(
    api.assets.listPage,
    orgId && kind === "serialized" ? { orgId, ...common, ...serializedQueryArgs(state, now) } : "skip",
  );
  const bulk = useAuthedQuery(
    api.bulkAssets.listPage,
    orgId && kind === "bulk" ? { orgId, ...common, ...bulkQueryArgs(state), statusIn: common.statusIn } : "skip",
  );
  // The two queries name their rows differently (`assets` / `bulkAssets`); give the shared hook one shape.
  const page = kind === "serialized"
    ? serialized && { items: serialized.assets, total: serialized.total, totalPages: serialized.totalPages }
    : bulk && { items: bulk.bulkAssets, total: bulk.total, totalPages: bulk.totalPages };
  const { data, total, isLoading } = usePaginatedTableResult(page as { items: unknown[]; total: number; totalPages: number } | undefined);
  const items = data as AssetSource[];
  const ids = React.useMemo(() => items.map((a) => a.id), [items]);
  const extras = useAuthedQuery(api.assets.rowExtras, orgId && kind === "serialized" && ids.length > 0 ? { orgId, ids } : "skip") as
    | Record<string, AssetExtras>
    | undefined;
  return { items, total, isLoading, extras, dueCap: kind === "serialized" ? (serialized?.dueCap ?? null) : null };
}

type Dialog = { kind: "edit" | "tags" | "force" | "retire"; ids: string[] } | null;

interface Perms {
  update: boolean;
  create: boolean;
  checkIn: boolean;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportRegistry(kind: AssetKind) {
  try {
    downloadCsv(kind === "serialized" ? await exportAssetsCSV() : await exportBulkAssetsCSV(), exportFilename(kind));
  } catch (e) {
    showError(e, { fallbackTitle: "Could not export" });
  }
}

function assetsPageMenu(kind: AssetKind, perms: Perms, openImport: () => void): ActionMenuSpec {
  if (!perms.create) return { items: [] };
  return {
    items: [
      { key: "export", label: "Export CSV", group: "reporting", icon: Download, onSelect: () => void exportRegistry(kind) },
      { key: "import", label: "Import CSV", group: "organise", icon: Upload, onSelect: openImport },
    ],
  };
}

/** Retires each serialised asset through the existing `archiveNative`; no Undo (the asset leaves the active registry). */
function useRetire(seen: React.MutableRefObject<Map<string, AssetSource>>) {
  const writes = useAssetWrites();
  const nameOf = (id: string) => seen.current.get(id)?.assetTag ?? id;
  async function retireMany(ids: string[]) {
    const out = await runBulk(ids, {
      name: nameOf,
      gate: (id) => (seen.current.get(id)?.status === "RETIRED" ? "already retired" : null),
      apply: async (id) => void (await writes.archive(id)),
    });
    const skipped = out.skipped.length > 0 ? ` · skipped ${out.skipped.map((s) => s.name).join(", ")}` : "";
    toast.success(`Retired ${plural(out.done.length, "asset")}${skipped}`);
  }
  return { retireMany };
}

export function AssetsList() {
  const { data: activeOrg } = useActiveOrganization();
  // Keyed by org: switching org remounts, so the seen-row cache and the selection never leak across orgs.
  return <AssetsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function AssetsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(ASSETS_SPEC);
  useRememberedView(state, setState);
  const kind = kindOf(state);
  const grid = state.view === "grid";
  const perms: Perms = {
    update: useCanDo("asset", "update"),
    create: useCanDo("asset", "create"),
    checkIn: useCanDo("warehouse", "check_in"),
  };

  const { items, total, isLoading, extras, dueCap } = useAssetsPage(orgId, state, now, kind);
  const photos = usePhotos(orgId);
  const seen = React.useRef(new Map<string, AssetSource>());
  React.useEffect(() => {
    for (const a of items) seen.current.set(a.id, a);
  }, [items]);

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [modelSearch, setModelSearch] = React.useState("");
  const { retireMany } = useRetire(seen);
  const lookups = useLookups(orgId);

  const rows = items.map((a) => {
    const href = kind === "bulk" ? `/assets/registry/${a.id}?type=bulk` : `/assets/registry/${a.id}`;
    const menu = buildAssetActions(
      { id: a.id, title: a.assetTag, kind, status: a.status },
      {
        onOpen: () => router.push(href),
        onEdit: perms.update && kind === "serialized" ? () => router.push(`/assets/registry/${a.id}/edit`) : undefined,
        onRetire: perms.update ? () => void retireMany([a.id]) : undefined,
      },
    );
    const row = assetRowOf(a, kind, extras?.[a.id] ?? {}, menu);
    return { ...row, cells: { status: row.status && <StatusWord status={row.status} /> } };
  });

  const goNew = () => router.push(`/assets/registry/new?type=${kind}`);
  const primary: ListPrimary | undefined = perms.create ? { label: kind === "bulk" ? "New bulk asset" : "New asset", onSelect: goNew } : undefined;
  const filters: ListFilterDef[] = assetFilters(kind, { ...lookups, modelSearch: { value: modelSearch, onChange: setModelSearch } });

  return (
    <>
      <ListPage
        spec={ASSETS_SPEC}
        title="Assets"
        noun="assets"
        bulkNoun="asset"
        searchPlaceholder="Search tag, serial, name or model"
        segments={grid ? [] : assetSegments(kind).map((s) => s)}
        filters={grid ? [] : filters}
        views={[
          { key: "table", label: "Table" },
          { key: "grid", label: "Grid" },
        ]}
        columns={kind === "bulk" ? BULK_COLUMNS : SERIALIZED_COLUMNS}
        columnsKey={`assets-${kind}`}
        notice={dueCap ? `Showing the first ${dueCap} test-and-tag schedules due; more are due than can be listed.` : undefined}
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={ASSET_ITEM_HEADER}
        itemSortKey={ASSET_ITEM_SORT_KEY}
        leading={(row) => <RowThumb row={row} items={items} photos={photos} />}
        primary={primary}
        pageMenu={grid ? undefined : assetsPageMenu(kind, perms, () => setImportOpen(true))}
        bulk={(ids) => assetsBulk(ids, kind, perms, seen, setDialog)}
        empty={{
          title: "No assets yet",
          description: "Every piece of gear your organisation owns, tracked individually.",
          action: primary,
        }}
        toolbarExtra={grid ? undefined : <AssetsSavedViews state={state} setState={setState} />}
        renderView={(view) => (view === "grid" ? <AssetGallery hostSearch={state.q} /> : null)}
      />
      <AssetsDialogs
        orgId={orgId}
        dialog={dialog}
        setDialog={setDialog}
        locations={lookups.locationRows}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        retireMany={retireMany}
      />
    </>
  );
}

/** Filter keys the pre-URL registry stored, renamed for the URL. */
const LEGACY_ASSET_FILTER_KEYS = { locationId: "loc", categoryId: "cat", tags: "tag" } as const;

function AssetsSavedViews({ state, setState }: { state: ListUrlState; setState: (s: ListUrlState) => void }) {
  return <UrlSavedViewsMenu tableId="assets" spec={ASSETS_SPEC} state={state} setState={setState} aliases={LEGACY_ASSET_FILTER_KEYS} />;
}

function useLookups(orgId: string | undefined) {
  const locationDocs = useLocations(orgId);
  const categoryDocs = useCategories(orgId);
  const modelDocs = useModels(orgId);
  const tags = useOrgTags(orgId);
  return React.useMemo(() => {
    const list = locationDocs ?? [];
    const nameById = new Map(list.map((l) => [l.id, l.name]));
    const locationRows = list.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type ?? "",
      parent: l.parentId ? { name: nameById.get(l.parentId) ?? "" } : null,
    }));
    return {
      locationRows,
      locations: locationRows.map((l) => ({ id: l.id, name: l.parent ? `${l.parent.name} > ${l.name}` : l.name })),
      categories: (categoryDocs ?? []).map((c) => ({ id: c.id, name: c.name })),
      models: (modelDocs ?? []).map((m) => ({ id: m.id, name: m.name })),
      tags,
    };
  }, [locationDocs, categoryDocs, modelDocs, tags]);
}

function RowThumb({ row, items, photos }: { row: LineRowData; items: AssetSource[]; photos: ReturnType<typeof usePhotos> }) {
  const a = items.find((i) => i.id === row.id);
  const thumb = photos?.assetPhotos?.[row.id] ?? (a ? photos?.modelPhotos?.[a.modelId] : undefined);
  return <MediaThumbnail url={thumb?.url} thumbnailUrl={thumb?.thumbnailUrl} alt={row.title} size={32} />;
}

/** Bulk verbs (serialised only): each reuses an existing dialog or mutation. A bulk-stock row has none yet. */
function assetsBulk(
  ids: string[],
  kind: AssetKind,
  perms: Perms,
  seen: React.MutableRefObject<Map<string, AssetSource>>,
  setDialog: (d: Dialog) => void,
) {
  if (kind !== "serialized") return [];
  const deployed = ids.filter((id) => ["CHECKED_OUT", "RESERVED"].includes(seen.current.get(id)?.status ?? ""));
  const open = (k: NonNullable<Dialog>["kind"], list = ids) => () => setDialog({ kind: k, ids: list });
  return buildAssetBulkActions({
    onEdit: perms.update ? open("edit") : undefined,
    onAddTag: perms.update ? open("tags") : undefined,
    forceReturnCount: deployed.length,
    onForceReturn: perms.checkIn ? open("force", deployed) : undefined,
    onRetire: perms.update ? open("retire") : undefined,
  });
}

function AssetsDialogs({
  orgId,
  dialog,
  setDialog,
  locations,
  importOpen,
  setImportOpen,
  retireMany,
}: {
  orgId: string | undefined;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  locations: Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>;
  importOpen: boolean;
  setImportOpen: (o: boolean) => void;
  retireMany: (ids: string[]) => Promise<void>;
}) {
  const warehouse = useWarehouseWrites();
  const ids = React.useMemo(() => new Set(dialog?.ids ?? []), [dialog]);
  const close = () => setDialog(null);
  const forceReturn = async () => {
    const list = dialog?.ids ?? [];
    close();
    try {
      const r = await warehouse.bulkForceReturnAssets(list);
      toast.success(`Force returned ${plural(r.count, "asset")} to available`);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not force return" });
    }
  };
  return (
    <>
      <BulkEditDialog open={dialog?.kind === "edit"} onOpenChange={(o) => !o && close()} selectedIds={ids} locations={locations} onSuccess={close} />
      <BulkAddTagsDialog open={dialog?.kind === "tags"} onOpenChange={(o) => !o && close()} selectedIds={ids} orgId={orgId} onSuccess={close} />
      <CSVImportDialog type="assets" open={importOpen} onOpenChange={setImportOpen} />
      <DeleteDialog
        open={dialog?.kind === "force"}
        onOpenChange={(o) => !o && close()}
        title={`Force return ${plural(ids.size, "asset")}?`}
        description="Job assignments are marked returned and statuses reset. Each asset returns to its home location. Use when scanning isn't possible."
        confirmLabel={`Force return ${ids.size}`}
        onConfirm={() => void forceReturn()}
        pending={false}
      />
      {dialog?.kind === "retire" && <RetireRun ids={dialog.ids} retireMany={retireMany} done={close} />}
    </>
  );
}

/** The bulk Retire's confirm is the ActionMenu's own; this just runs it once on mount. */
function RetireRun({ ids, retireMany, done }: { ids: string[]; retireMany: (ids: string[]) => Promise<void>; done: () => void }) {
  React.useEffect(() => {
    void retireMany(ids).finally(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per opened batch
  }, []);
  return null;
}
