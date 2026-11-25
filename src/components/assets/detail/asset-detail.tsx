"use client";
// use-client: live Convex data via client subscription (R-8.1.1)

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageMeta } from "@/components/layout/page-meta";
import { DetailHeader } from "@/components/ui/detail-header";
import { TabStrip } from "@/components/ui/tab-strip";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { AssetSheet, type AssetSheetState } from "@/components/assets/asset-sheet";
import { AssetChecksTab } from "@/components/assets/asset-checks-tab";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useNativeAsset } from "@/hooks/use-native-asset";
import { useRetireAssets } from "@/hooks/use-retire-assets";
import { resolveAssetTab, assetTabItems, type AssetTabKey } from "@/lib/asset-tabs";
import { assetEditValues } from "@/lib/asset-edit-values";
import { buildAssetPageActions } from "@/lib/row-actions/asset";
import { getStatusIntent } from "@/lib/status-colors";
import { assetStatusLabels, formatLabel } from "@/lib/status-labels";
import { resolveAssetPhotoUrl } from "@/lib/media-utils";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import type { AssetHealth } from "../../../../convex/lib/assetHealth";
import { AssetOverview, AssetRail } from "./asset-overview";
import { FilesTab, HistoryTab, MaintenanceTab, NotesTab } from "./asset-tab-bodies";
import { AssetDialogsHost, type AssetDialog } from "./asset-dialogs-host";
import { useAssetHealth } from "./use-asset-health";
import { useAssetScan } from "./use-asset-scan";

type Asset = NativeAssetDetail;

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-ui-text text-ink-2">Asset not found.</p>
      <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      <Button variant="line" size="sm" className="mt-4" asChild><Link href="/assets/registry">Back to assets</Link></Button>
    </div>
  );
}

/** `?date=2026-12-03` seeds the Availability tab (kept from the old page). */
function dateParam(d: string | null): Date | null {
  const [y, m, day] = (d ?? "").split("-").map(Number);
  const parsed = y && m && day ? new Date(y, m - 1, day) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/** The non-Overview tab bodies. Overview is its own component: it has no rail (nothing shows twice). */
function TabBody({ tab, asset, orgId, photoUrl, date }: { tab: AssetTabKey; asset: Asset; orgId: string | undefined; photoUrl: string | null; date: Date | null }) {
  switch (tab) {
    case "availability": return <BookingCalendar entityType="asset" entityId={asset.id} modelId={asset.modelId ?? undefined} initialDate={date} />;
    case "checks": return <AssetChecksTab assetId={asset.id} />;
    case "maintenance": return <MaintenanceTab asset={asset} />;
    case "history": return <HistoryTab asset={asset} />;
    case "notes": return <NotesTab asset={asset} orgId={orgId} />;
    case "files": return <FilesTab asset={asset} photoUrl={photoUrl} />;
    default: return null;
  }
}

function photoCount(asset: Asset): number {
  const photos = ((asset.media ?? []) as { type?: string }[]).filter((m) => m.type === "PHOTO").length;
  const docs = ((asset.model?.media ?? []) as { type?: string }[]).filter((m) => m.type !== "PHOTO").length;
  return photos + docs;
}

export function AssetDetail({ id }: { id: string }) {
  const { data: org } = useActiveOrganization();
  const { data: asset, isLoading } = useNativeAsset(id, org?.id);
  const health = useAssetHealth(asset, org?.id);
  if (isLoading) return <DetailPageSkeleton />;
  if (!asset || !health) return <NotFound />;
  return <AssetView asset={asset} health={health} orgId={org?.id} />;
}

function AssetView({ asset, health, orgId }: { asset: Asset; health: AssetHealth; orgId: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isMobile = useIsMobile();
  const { reinstateMany } = useRetireAssets();
  const may = { update: useCanDo("asset", "update"), create: useCanDo("asset", "create"), maint: useCanDo("maintenance", "create"), checkIn: useCanDo("warehouse", "check_in") };
  const [dialog, setDialog] = useState<AssetDialog>(null);
  const [newLike, setNewLike] = useState<AssetSheetState | null>(null);
  const tag = asset.assetTag;
  const { scan } = useAssetScan(tag);

  // The URL is the state: `?tab=` and `?edit=1` (the old /edit route redirects here).
  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value == null) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const tab = resolveAssetTab(params.get("tab"));
  const openTab = (t: AssetTabKey) => setParam("tab", t === "overview" ? null : t);
  const editing = params.get("edit") === "1" && may.update;
  const openEdit = () => setParam("edit", "1");
  const startNewLike = () => setNewLike({ mode: "create", kind: "serialized", defaults: { modelId: asset.modelId ?? undefined, locationId: asset.locationId ?? undefined, condition: asset.condition as never, supplierId: asset.supplierId ?? undefined } });
  useKeyboardShortcut("e", openEdit, may.update);
  useKeyboardShortcut("n", startNewLike, may.create);
  useKeyboardShortcut("/", () => setDialog("scan"), true);

  const open = (d: Exclude<AssetDialog, null>) => () => setDialog(d);
  const menu = buildAssetPageActions(asset, {
    onScan: open("scan"),
    onMove: may.update ? open("move") : undefined,
    onScheduleService: may.maint ? open("service") : undefined,
    onReportIssue: may.maint ? open("report") : undefined,
    onPrintLabel: open("label"),
    onNewLike: may.create ? startNewLike : undefined,
    onForceReturn: may.checkIn ? open("force") : undefined,
    onRetire: may.update ? open("retire") : undefined,
    onReinstate: may.update ? () => void reinstateMany([{ id: asset.id, tag, kind: "serialized", status: asset.status }]) : undefined,
  });
  const photoUrl = resolveAssetPhotoUrl({ ...asset, model: asset.model ?? undefined }, false);
  const meta = [
    asset.customName,
    asset.model ? <Link key="m" href={`/assets/models/${asset.modelId}`} className="hover:text-ink hover:underline">{asset.model.name}</Link> : null,
    asset.model?.category?.name,
    asset.location?.name,
  ].filter(Boolean) as React.ReactNode[];

  return (
    <div className="space-y-5">
      <PageMeta title={`${tag}${asset.customName ? ` — ${asset.customName}` : ""}`} />
      <DetailHeader
        title={tag}
        status={{ label: assetStatusLabels[asset.status] ?? formatLabel(asset.status), intent: getStatusIntent("asset", asset.status) }}
        meta={meta}
        onEdit={may.update ? openEdit : undefined}
        menu={menu}
      />
      <TabStrip
        items={assetTabItems({ maintenance: asset.maintenanceLinks.length, history: asset.lineItems.length, files: photoCount(asset) })}
        value={tab}
        onValueChange={(v) => openTab(v as AssetTabKey)}
        idPrefix="asset"
      />
      {tab === "overview" ? (
        <AssetOverview
          asset={asset}
          health={health}
          photoUrl={photoUrl}
          actions={{
            openTab,
            registerTestTag: may.create ? () => router.push(`/test-and-tag/new?assetId=${asset.id}`) : undefined,
            viewTestTag: asset.testTagAsset ? () => router.push(`/test-and-tag/${asset.testTagAsset!.id}`) : undefined,
            scheduleService: may.maint ? open("service") : undefined,
            reportIssue: may.maint ? open("report") : undefined,
          }}
        />
      ) : (
        <div className="flex gap-8">
          <div className="min-w-0 flex-1"><TabBody tab={tab} asset={asset} orgId={orgId} photoUrl={photoUrl} date={dateParam(params.get("date"))} /></div>
          <AssetRail asset={asset} />
        </div>
      )}
      {isMobile ? <PinnedAboveBottomNav><Button className="h-11 w-full" onClick={open("scan")}>Scan</Button></PinnedAboveBottomNav> : null}
      <AssetDialogsHost asset={asset} dialog={dialog} setDialog={setDialog} onScan={scan} />
      <AssetSheet
        state={editing ? { mode: "edit", kind: "serialized", values: assetEditValues(asset) } : newLike}
        onClose={() => { if (editing) setParam("edit", null); setNewLike(null); }}
        onSaved={(r) => { if (newLike && !r.again) router.push(`/assets/registry/${r.id}`); }}
      />
    </div>
  );
}
