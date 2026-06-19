"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ImageIcon, Plus, Search } from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { getAssetRegistryPhotos } from "@/server/assets";
import { useAssets } from "@/hooks/use-assets";
import { useModels } from "@/hooks/use-models";
import { useActiveOrganization } from "@/lib/auth-client";
import { useLocations } from "@/hooks/use-locations";
import { useCategories } from "@/hooks/use-categories";
import { useServerQuery } from "@/hooks/use-server-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CanDo } from "@/components/auth/permission-gate";
import { assetStatusLabels, conditionLabels } from "@/lib/status-labels";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAsset = Record<string, any>;

/**
 * Asset gallery — a visual gear library. A responsive card grid (the same
 * serialized assets the AssetTable shows), pulled from the SAME reactive Convex
 * source (`useAssets`) and enriched with the SAME cross-domain photos
 * (`getAssetRegistryPhotos`). Cards group under a calm muted category overline.
 *
 * Read-only browse surface: it carries its own search box + the New-asset action;
 * the dense filters / bulk-select / CSV live in the Table view (AssetTable).
 *
 * The toolbar slot (`toolbar`) is injected by AssetsView so the Grid⇄Table toggle
 * sits inline with the search box.
 */
export function AssetGallery({ toolbar }: { toolbar?: React.ReactNode }) {
  const [search, setSearch] = useState("");

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Same reactive sources the AssetTable uses — both views stay in lockstep.
  const allAssets = useAssets(orgId);
  const allModels = useModels(orgId);
  const locationsDocs = useLocations(orgId);
  const categoriesDocs = useCategories(orgId);
  const { data: photos } = useServerQuery({
    queryKey: ["asset-registry-photos", orgId],
    queryFn: () => getAssetRegistryPhotos(),
    enabled: !!orgId,
  });

  const modelById = useMemo(() => new Map((allModels ?? []).map((m) => [m.id, m])), [allModels]);
  const categoryById = useMemo(
    () => new Map((categoriesDocs ?? []).map((c) => [c.id, c])),
    [categoriesDocs],
  );
  const locationById = useMemo(
    () => new Map((locationsDocs ?? []).map((l) => [l.id, l])),
    [locationsDocs],
  );

  // Mirror AssetTable's enrich(): resolve model (+ category + primary media),
  // location, and the asset's own primary photo from the merged photo query.
  const enrich = useMemo(() => {
    const assetPhotos = photos?.assetPhotos ?? {};
    const modelPhotos = photos?.modelPhotos ?? {};
    return (row: AnyAsset) => {
      const model = modelById.get(row.modelId);
      const category = model?.categoryId ? categoryById.get(model.categoryId) ?? null : null;
      const mPhoto = modelPhotos[row.modelId];
      const aPhoto = assetPhotos[row.id];
      return {
        ...row,
        model: model ? { ...model, category, media: mPhoto ? [{ file: mPhoto }] : [] } : null,
        location: row.locationId ? locationById.get(row.locationId) ?? null : null,
        media: aPhoto ? [{ file: aPhoto }] : [],
      };
    };
  }, [modelById, categoryById, locationById, photos]);

  // Filter (active only) + client-side search, then enrich. Sorted by model name
  // so the library reads like a catalogue.
  const visible = useMemo(() => {
    if (!allAssets) return undefined;
    const q = search.trim().toLowerCase();
    return allAssets
      .filter((a) => a.isActive !== false)
      .filter((a) => {
        if (!q) return true;
        const name = modelById.get(a.modelId)?.name?.toLowerCase() ?? "";
        return (
          a.assetTag.toLowerCase().includes(q)
          || (a.serialNumber?.toLowerCase().includes(q) ?? false)
          || (a.customName?.toLowerCase().includes(q) ?? false)
          || name.includes(q)
        );
      })
      .map(enrich)
      .sort((a, b) =>
        String(a.model?.name ?? "").localeCompare(String(b.model?.name ?? ""), undefined, {
          sensitivity: "base",
        }),
      );
  }, [allAssets, modelById, search, enrich]);

  // Group cards under their category (assets with no category fall under
  // "Uncategorised"). Groups are ordered alphabetically; uncategorised last.
  const groups = useMemo(() => {
    if (!visible) return undefined;
    const byCategory = new Map<string, AnyAsset[]>();
    for (const a of visible) {
      const label = a.model?.category?.name ?? "Uncategorised";
      if (!byCategory.has(label)) byCategory.set(label, []);
      byCategory.get(label)!.push(a);
    }
    return [...byCategory.entries()].sort(([a], [b]) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  }, [visible]);

  const isLoading = allAssets === undefined;

  return (
    <div className="space-y-4">
      {/* toolbar: search + view toggle + new-asset */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by tag, serial, or name…"
            className={cn(
              "h-10 w-full rounded-[var(--r)] border-2 border-input bg-card pl-9 pr-3 text-[14px] text-ink placeholder:text-faint",
              focusRing,
            )}
          />
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          <CanDo resource="asset" action="create">
            <Button asChild variant="halo">
              <Link href="/assets/registry/new?type=serialized">
                <Plus className="h-4 w-4" /> New asset
              </Link>
            </Button>
          </CanDo>
        </div>
      </div>

      {/* grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[var(--r-lg)]" />
          ))}
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border border-dashed border-line py-16 text-center">
          <FlowMascot className="h-12 w-12" />
          <p className="text-[15px] font-medium text-ink">
            {search ? "No gear matches that." : "No gear yet."}
          </p>
          <p className="t-micro text-muted">
            {search ? "Try a looser search." : "Add your first asset to start the library."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([category, items]) => (
            <section key={category} className="space-y-3">
              <div className="flex items-baseline gap-2 px-1">
                <span className="t-overline text-muted">{category}</span>
                <span className="t-mono text-faint">{items.length}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset }: { asset: AnyAsset }) {
  // Same photo resolver the table's MediaThumbnail uses: asset's own primary photo
  // first, then the model's primary photo; thumbnail preferred over full. Rendered
  // as a fill cover (MediaThumbnail is fixed-pixel-sized, so we reuse its resolver
  // + placeholder fallback inline for an edge-to-edge card cover).
  const src =
    asset.media?.[0]?.file?.thumbnailUrl
    || asset.media?.[0]?.file?.url
    || asset.model?.media?.[0]?.file?.thumbnailUrl
    || asset.model?.media?.[0]?.file?.url;
  const locationName = asset.location?.name as string | undefined;
  const conditionLabel = asset.condition ? conditionLabels[asset.condition] : null;

  return (
    <Link
      href={`/assets/registry/${asset.id}`}
      className={cn(
        "group block overflow-hidden rounded-[var(--r-lg)] border-2 border-line bg-card shadow-[var(--sh-card)] transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-hover)]",
        focusRing,
      )}
    >
      {/* cover photo */}
      <div className="aspect-[4/3] w-full overflow-hidden border-b-2 border-line bg-bg-inset">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={asset.model?.name ?? asset.assetTag}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-faint" />
          </div>
        )}
      </div>
      {/* body */}
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">
              {asset.model?.name ?? "Unknown model"}
            </p>
            <p className="t-mono truncate text-muted">{asset.assetTag}</p>
          </div>
          <StatusIndicator
            category="asset"
            value={asset.status}
            label={assetStatusLabels[asset.status] ?? asset.status}
            variant="pill"
            className="shrink-0"
          />
        </div>
        {(conditionLabel || locationName) && (
          <p className="t-micro truncate text-muted">
            {conditionLabel}
            {conditionLabel && locationName ? <span className="text-faint"> · </span> : null}
            {locationName}
          </p>
        )}
      </div>
    </Link>
  );
}
