"use client";

import Link from "next/link";

import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import type { AssetHealth, HealthFix } from "../../../../convex/lib/assetHealth";
import type { AssetTabKey } from "@/lib/asset-tabs";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { ChecklistSection, type ChecklistRow } from "@/components/ui/checklist-section";
import { CanDo } from "@/components/auth/permission-gate";
import { CustomFieldsDisplay } from "@/components/custom-fields/custom-fields-display";
import { AssetAccessoriesManager } from "@/components/assets/asset-accessories-manager";
import { identityRows, type IdentityRow } from "@/lib/asset-identity";
import { cn, focusRing } from "@/lib/utils";
import { Fact, LastScanFact, NowFact, ValueFact } from "./asset-facts";

type Asset = NativeAssetDetail;

/** Where a health row's action goes: the surface that owns the fix. The page supplies the verbs. */
export interface HealthActions {
  openTab: (tab: AssetTabKey) => void;
  registerTestTag?: () => void;
  viewTestTag?: () => void;
  scheduleService?: () => void;
  reportIssue?: () => void;
}

const TONE = { "Ready to go": "clear", "Nearly ready": "warning", "Can't go out": "blocking" } as const;

/** Maps `assetHealth()`'s rows onto the checklist; an action the caller cannot do is left off (the row still reads). */
function healthRows(health: AssetHealth, a: HealthActions): ChecklistRow[] {
  const handler = (fix?: HealthFix): (() => void) | undefined => {
    if (!fix) return undefined;
    switch (fix.kind) {
      case "tab": return () => a.openTab(fix.tab);
      case "register-test-tag": return a.registerTestTag;
      case "view-test-tag": return a.viewTestTag;
      case "schedule-service": return a.scheduleService;
      case "report-issue": return a.reportIssue;
    }
  };
  return health.checks.map((c) => {
    const onAction = handler(c.fix);
    return { id: c.id, severity: c.severity, title: c.title, detail: c.detail, onAction, actionLabel: onAction ? c.actionLabel : undefined };
  });
}

function IdentityValue({ row }: { row: IdentityRow }) {
  if (row.href) return <Link href={row.href} className={cn("hover:underline", focusRing)}>{row.value}</Link>;
  return <span className={row.mono ? "t-mono" : undefined}>{row.value}</span>;
}

function Identity({ asset }: { asset: Asset }) {
  return (
    <section aria-label="Identity">
      <h3 className="text-card-title font-bold text-ink">Identity</h3>
      <dl className="mt-2 grid gap-x-8 sm:grid-cols-2">
        {identityRows(asset).map((row, i) => (
          <div key={`${row.label}-${i}`} className="flex justify-between gap-3 border-t border-line py-1.5 text-table-cell">
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 text-right text-ink"><IdentityValue row={row} /></dd>
          </div>
        ))}
      </dl>
      <CustomFieldsDisplay entityType="ASSET" values={asset.customFieldValues as Record<string, string> | null | undefined} />
    </section>
  );
}

function ReadOnlyAccessories({ asset }: { asset: Asset }) {
  const own = new Set(asset.childBulkItems.map((c) => c.bulkAssetId));
  const inherited = (asset.model?.bulkAccessories ?? []).filter((m) => !own.has(m.bulkAssetId));
  const total = asset.childAssets.length + asset.childBulkItems.length + inherited.length;
  if (total === 0) return <p className="text-table-cell text-muted">No accessories attached.</p>;
  return (
    <ul className="space-y-1 text-table-cell">
      {asset.childAssets.map((c) => <li key={c.id}><span className="font-medium">{c.assetTag}</span> <span className="text-muted">{c.model?.name ?? ""}</span></li>)}
      {asset.childBulkItems.map((c) => <li key={c.id} className="font-medium">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</li>)}
      {inherited.map((c) => <li key={c.id}><span className="font-medium">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</span> <span className="text-badge text-muted">from model</span></li>)}
    </ul>
  );
}

/**
 * Overview (§9d.2): the health checklist first, then `Now · Last scan · Value` in three
 * columns, the identity, and the accessories as rows. It shows no table. Nothing here is
 * stored: health is derived (`assetHealth`), the facts are the shared components.
 */
export function AssetOverview({ asset, health, photoUrl, actions }: { asset: Asset; health: AssetHealth; photoUrl: string | null; actions: HealthActions }) {
  return (
    <div className="space-y-8">
      <div className="flex gap-4">
        <MediaThumbnail url={photoUrl} alt={asset.assetTag} size={72} className="shrink-0" />
        <ChecklistSection
          className="min-w-0 flex-1"
          headline={health.headline}
          tone={TONE[health.headline]}
          summary={`${health.clear} of ${health.total} checks clear`}
          rows={healthRows(health, actions)}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <NowFact asset={asset} />
        <LastScanFact asset={asset} />
        <ValueFact asset={asset} />
      </div>

      <Identity asset={asset} />

      {!asset.parentAsset ? (
        <section aria-label="Accessories">
          <h3 className="text-card-title font-bold text-ink">Accessories</h3>
          <div className="mt-2">
            <CanDo resource="asset" action="update" fallback={<ReadOnlyAccessories asset={asset} />}>
              <AssetAccessoriesManager
                assetId={asset.id}
                childAssets={asset.childAssets}
                childBulkItems={asset.childBulkItems}
                inheritedBulkItems={asset.model?.bulkAccessories ?? []}
                onChanged={() => undefined}
              />
            </CanDo>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Used by the rail: the same four facts, `Now · Last scan · Value`, stacked. Not shown on Overview or on a phone. */
export function AssetRail({ asset }: { asset: Asset }) {
  return (
    <aside aria-label="Asset facts" className="hidden w-60 shrink-0 space-y-5 lg:block">
      <NowFact asset={asset} />
      <LastScanFact asset={asset} />
      <ValueFact asset={asset} />
      <Fact label="Model">
        <Link href={`/assets/models/${asset.modelId}`} className={cn("font-semibold hover:underline", focusRing)}>{asset.model?.name ?? "Model"}</Link>
      </Fact>
    </aside>
  );
}
