"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ImageIcon, Plus, Search } from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActiveOrganization } from "@/lib/auth-client";
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
 * Asset gallery — a visual gear library. A responsive card grid of every active
 * serialized asset, pulled from `assets.listGallery` (one server-side query
 * doing the model/category/location joins + search filtering Convex-side) and
 * enriched with the SAME cross-domain photos (`getAssetRegistryPhotos`). Cards
 * group under a calm muted category overline.
 *
 * Deliberately unpaginated ("show everything, grouped" is the feature — see
 * docs/designs/perf-convex-efficiency-2026-06.md Finding #1 "Option A"), unlike
 * the Table view (AssetTable), which paginates via `assets.listPage`.
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

  // ONE server-side query (filter + sort + model/category/location joins all
  // done in Convex) instead of the 4 whole-org live subscriptions this used to
  // mount (assets/models/categories/locations) and join client-side. Still
  // reads every active asset — "show everything, grouped" is the feature — see
  // docs/designs/perf-convex-efficiency-2026-06.md Finding #1 ("Option A").
  // Search is debounced since each keystroke is now a real round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  const list = useAuthedQuery(
    api.assets.listGallery,
    orgId ? { orgId, search: debouncedSearch.trim() || undefined } : "skip",
  );

  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: photos } = useServerQuery({
    queryKey: ["asset-registry-photos", orgId, isAuthenticated],
    queryFn: () => convex.query(api.assets.registryPhotos, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  // listGallery already resolves model (+ category) and location server-side —
  // enrich only needs to merge in the (separate, non-reactive) photo lookup.
  const enrich = useMemo(() => {
    const assetPhotos = photos?.assetPhotos ?? {};
    const modelPhotos = photos?.modelPhotos ?? {};
    return (row: AnyAsset) => {
      const mPhoto = row.modelId ? modelPhotos[row.modelId] : undefined;
      const aPhoto = assetPhotos[row.id];
      return {
        ...row,
        model: row.model ? { ...row.model, media: mPhoto ? [{ file: mPhoto }] : [] } : null,
        media: aPhoto ? [{ file: aPhoto }] : [],
      };
    };
  }, [photos]);

  const visible = useMemo(() => (list ? list.map(enrich) : undefined), [list, enrich]);

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

  const isLoading = list === undefined;

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
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-[var(--r-lg)]" />
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
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
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
      <div className="space-y-1.5 p-2.5">
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
