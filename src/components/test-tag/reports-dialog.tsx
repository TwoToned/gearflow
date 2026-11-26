"use client";

import * as React from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { ArrowLeft, Download, FileDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerQuery } from "@/hooks/use-server-query";
import { REPORT_CONFIGS, reportFilterError, reportUrl, type ReportConfig, type ReportFormat } from "@/lib/test-tag-reports";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

type Filters = Record<string, string>;
const pickRow = "w-full text-left px-3 py-2 text-ui-text min-h-11 hover:bg-elev transition-colors";

/** Download a CSV through the report route, or open the PDF in a new tab (the route streams it). */
async function generate(config: ReportConfig, filters: Filters, format: ReportFormat): Promise<void> {
  const url = reportUrl(config.key, filters, format);
  if (format === "pdf") {
    window.open(url, "_blank");
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Download failed" }));
    throw new Error(err.error || "Download failed");
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = `tt-${config.key}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success("CSV downloaded");
}

function DateRange({ filters, set }: { filters: Filters; set: (k: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["dateFrom", "dateTo"] as const).map((k) => (
        <div key={k} className="space-y-1.5">
          <Label htmlFor={k}>{k === "dateFrom" ? "From" : "To"}</Label>
          <Input id={k} type="date" value={filters[k] || ""} onChange={(e) => set(k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}

/** Pick one item (by tag or description) for the item-history report. */
function ItemPicker({ orgId, filters, set }: { orgId: string | undefined; filters: Filters; set: (k: string, v: string) => void }) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [text, setText] = React.useState("");
  const results = useServerQuery({
    queryKey: ["tt-reports-item-search", orgId, text, isAuthenticated],
    queryFn: () => convex.query(api.testTagAssets.listPage, { orgId: orgId!, search: text, pageSize: 5 }),
    enabled: text.length >= 2 && !!orgId && isAuthenticated,
  });
  return (
    <div className="space-y-1.5">
      <Label htmlFor="report-item">Select item</Label>
      <Input id="report-item" value={text} placeholder="Search by tag ID or description..." onChange={(e) => { setText(e.target.value); set("testTagAssetId", ""); }} />
      {results.data?.items && results.data.items.length > 0 && !filters.testTagAssetId && (
        <div className="max-h-40 divide-y divide-line overflow-y-auto rounded-[var(--r)] ring-1 ring-line">
          {results.data.items.map((item) => (
            <button key={item.id} type="button" className={cn(pickRow, focusRing)} onClick={() => { set("testTagAssetId", item.id); setText(`${item.testTagId} - ${item.description}`); }}>
              <span className="t-mono font-medium text-ink">{item.testTagId}</span>
              <span className="ml-2 text-muted">{item.description}</span>
            </button>
          ))}
        </div>
      )}
      {filters.testTagAssetId && <p className="text-caption text-ok">Item selected</p>}
    </div>
  );
}

/** Pick one bulk asset for the bulk summary. */
function BulkPicker({ orgId, filters, set }: { orgId: string | undefined; filters: Filters; set: (k: string, v: string) => void }) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const bulk = useServerQuery({
    queryKey: ["tt-reports-bulk-assets", orgId, isAuthenticated],
    queryFn: () => convex.query(api.testTagAssets.listPage, { orgId: orgId!, assetLinkType: "bulk", pageSize: 100 }),
    enabled: !!orgId && isAuthenticated,
  });
  const unique = [...new Map((bulk.data?.items ?? []).filter((i) => i.bulkAsset).map((i) => [i.bulkAsset!.id, i.bulkAsset!])).values()];
  return (
    <div className="space-y-1.5">
      <Label>Select bulk asset</Label>
      {unique.length === 0 ? (
        <p className="text-ui-text text-muted">No bulk assets with T&amp;T items found.</p>
      ) : (
        <div className="max-h-48 divide-y divide-line overflow-y-auto rounded-[var(--r)] ring-1 ring-line">
          {unique.map((ba) => (
            <button key={ba.id} type="button" className={cn(pickRow, filters.bulkAssetId === ba.id && "bg-select", focusRing)} onClick={() => set("bulkAssetId", ba.id)}>
              <span className="t-mono font-medium text-ink">{ba.assetTag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One report's filters and its Generate buttons. */
function ReportForm({ config, orgId, onBack }: { config: ReportConfig; orgId: string | undefined; onBack: () => void }) {
  const [filters, setFilters] = React.useState<Filters>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const run = async (format: ReportFormat) => {
    const problem = reportFilterError(config.key, filters);
    if (problem) return void toast.error(problem);
    setBusy(true);
    try {
      await generate(config, filters, format);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report generation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{config.title}</DialogTitle>
        <DialogDescription>{config.description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {config.filters.includes("dateFrom") && <DateRange filters={filters} set={set} />}
        {config.filters.includes("search") && (
          <div className="space-y-1.5">
            <Label htmlFor="report-search">Search</Label>
            <Input id="report-search" value={filters.search || ""} onChange={(e) => set("search", e.target.value)} placeholder="Filter by tag ID, description, make, model..." />
          </div>
        )}
        {config.filters.includes("testTagAssetId") && <ItemPicker orgId={orgId} filters={filters} set={set} />}
        {config.filters.includes("bulkAssetId") && <BulkPicker orgId={orgId} filters={filters} set={set} />}
      </div>
      <DialogFooter className="flex gap-2 sm:justify-start">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />All reports</Button>
        {config.formats.includes("pdf") && <Button onClick={() => void run("pdf")} loading={busy}><FileDown className="mr-2 h-4 w-4" />Generate PDF</Button>}
        {config.formats.includes("csv") && <Button variant="line" onClick={() => void run("csv")} loading={busy}><Download className="mr-2 h-4 w-4" />Download CSV</Button>}
      </DialogFooter>
    </>
  );
}

/**
 * `Reports…` (UX Phase 14, 14a-3b, D44): the ten Test & tag reports in a dialog from the list's menu instead of the old
 * `/test-and-tag/reports` page. Pick a report, fill the filters it asks for (`src/lib/test-tag-reports.ts` is the one table),
 * then Generate PDF (opens the report route) or Download CSV. The routes and their permission are unchanged.
 */
export function ReportsDialog({ open, onOpenChange, orgId }: { open: boolean; onOpenChange: (open: boolean) => void; orgId: string | undefined }) {
  const [active, setActive] = React.useState<ReportConfig | null>(null);
  React.useEffect(() => { if (!open) setActive(null); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {active ? (
          <ReportForm config={active} orgId={orgId} onBack={() => setActive(null)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reports</DialogTitle>
              <DialogDescription>Compliance reports and exports.</DialogDescription>
            </DialogHeader>
            <ul className="divide-y divide-line rounded-[var(--r)] ring-1 ring-line">
              {REPORT_CONFIGS.map((r) => (
                <li key={r.key}>
                  <button type="button" className={cn(pickRow, "flex items-center justify-between gap-3", focusRing)} onClick={() => setActive(r)}>
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-caption text-muted">{r.description}</span>
                    </span>
                    <span className="shrink-0 text-badge text-muted">{r.formats.map((f) => f.toUpperCase()).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
