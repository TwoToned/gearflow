"use client";

import Link from "next/link";

import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import { whereaboutsOf, whereaboutsText, type Whereabouts } from "@/lib/asset-whereabouts";
import { assetStatusLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";

/**
 * The four facts the asset page shows, each defined ONCE (spec §9d.2): Overview composes
 * Now · Last scan · Value into three columns and the context rail on every other tab
 * prints the same components, so a fact never shows twice on one screen and the two can
 * never drift. (Owner is not a field Flow stores, so there is none.)
 */
type Asset = NativeAssetDetail;

export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 space-y-0.5 text-table-cell text-ink">{children}</div>
    </div>
  );
}

const statusLabel = (s: string) => assetStatusLabels[s] ?? formatLabel(s);
const link = cn("font-semibold text-ink hover:text-link hover:underline rounded-sm", focusRing);

/** Where it is now: the five-branch locator (deployed / maintenance / available / sold / status), with the job as a link. */
export function NowFact({ asset }: { asset: Asset }) {
  const dueBack = asset.facts.dueBackAt;
  return (
    <Fact label="Now">
      <Locator w={whereaboutsOf(asset)} />
      {dueBack ? <p className="text-muted">Due back {formatDate(new Date(dueBack))}</p> : null}
      <ParentLine parent={asset.parentAsset} />
    </Fact>
  );
}

/** The locator sentence; a job is a link (deployed and sold-on-a-job both name theirs). */
function Locator({ w }: { w: Whereabouts }) {
  if (w.kind !== "deployed" && w.kind !== "sold") return <p>{whereaboutsText(w, statusLabel)}</p>;
  return (
    <>
      <p>
        {w.kind === "sold" ? "Sold on " : "Out on "}
        <Link href={`/projects/${w.job.projectId}`} className={link}>{w.job.name}</Link>
        <span className="t-mono text-muted"> · {w.job.number}</span>
      </p>
      {w.kind === "deployed" && w.home ? <p className="text-muted">Home: {w.home}</p> : null}
    </>
  );
}

function ParentLine({ parent }: { parent: Asset["parentAsset"] }) {
  if (!parent) return null;
  return (
    <p>
      <Link href={`/assets/registry/${parent.id}`} className={link}>Accessory of {parent.assetTag}</Link>
      {parent.customName ? <span className="text-muted"> {parent.customName}</span> : null}
    </p>
  );
}

/** The last time this unit was seen: a scan or a check, from records that already exist (no scan write of its own). */
export function LastScanFact({ asset }: { asset: Asset }) {
  const at = asset.facts.lastScanAt;
  return (
    <Fact label="Last scan">
      {at ? <p>{formatDate(new Date(at))}</p> : <p className="text-muted">No scan on record</p>}
    </Fact>
  );
}

/** What it is worth and cost. Cost is ABSENT (null) for a caller who may not see it, and is then not printed. */
export function ValueFact({ asset }: { asset: Asset }) {
  const rows: [string, string][] = [];
  if (asset.model?.replacementCost != null) rows.push(["Replacement", formatCurrency(asset.model.replacementCost)]);
  if (asset.purchasePrice != null) rows.push(["Cost", formatCurrency(asset.purchasePrice)]);
  const supplier = asset.supplier?.name || asset.purchaseSupplier;
  if (supplier) rows.push(["Supplier", supplier]);
  if (asset.warrantyExpiry) rows.push(["Warranty", `to ${formatDate(asset.warrantyExpiry)}`]);
  return (
    <Fact label="Value">
      {rows.length === 0 ? <p className="text-muted">Nothing recorded</p> : rows.map(([k, v]) => (
        <p key={k}><span className="text-muted">{k} </span>{v}</p>
      ))}
    </Fact>
  );
}
