"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../convex/_generated/api";
import { SalesStockAdjustDialog, type AdjustRequest, type AdjustTarget } from "@/components/assets/sales-stock-adjust-dialog";
import { ReorderLevelDialog, type ReorderTarget } from "@/components/assets/reorder-level-dialog";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useModelWrites } from "@/hooks/use-model-writes";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useActiveOrganization } from "@/lib/auth-client";
import { toCsv } from "@/lib/csv";
import { withPatch } from "@/lib/list-url-state";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import {
  SALES_STOCK_COLUMNS,
  SALES_STOCK_ITEM_HEADER,
  SALES_STOCK_ITEM_SORT_KEY,
  SALES_STOCK_SPEC,
  saleStockRowOf,
  salesStockFilters,
  salesStockQueryArgs,
  salesStockSegments,
  type SaleStockSource,
} from "@/lib/list-views/sales-stock";
import { buildSaleStockActions, buildSaleStockBulkActions } from "@/lib/row-actions/sales-stock";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";
import { toast } from "sonner";

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Keyed by org: the seen-row cache and the selection never leak across an org switch. */
export function SalesStockList() {
  const { data: activeOrg } = useActiveOrganization();
  return <SalesStockListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function SalesStockListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const { state, setState } = useListUrlState(SALES_STOCK_SPEC);
  const canUpdate = useCanDo("model", "update");
  const writes = useModelWrites();

  const page = useAuthedQuery(api.modelsList.saleStockPage, orgId ? { orgId, ...salesStockQueryArgs(state) } : "skip");
  const counts = useAuthedQuery(api.modelsList.saleStockSegmentCounts, orgId ? { orgId } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: SaleStockSource[]; total: number; totalPages: number } | undefined);
  const categories = useCategories(orgId);

  // Phone pages accumulate: handlers read the row at click time, from every row seen so far.
  const seen = React.useRef(new Map<string, SaleStockSource>());
  React.useEffect(() => {
    for (const s of items) seen.current.set(s.id, s);
  }, [items]);

  const [targets, setTargets] = React.useState<AdjustTarget[] | null>(null);
  const targetsFor = (ids: string[]): AdjustTarget[] =>
    ids.flatMap((id) => {
      const s = seen.current.get(id);
      return s ? [{ id, name: s.name, available: s.available }] : [];
    });

  /** ONE guarded Undo closure per write (`announceListWrite`); the server refuses if any stock moved since. */
  const adjust = async (req: AdjustRequest) => {
    try {
      const { auditIds, count } = await writes.adjustSaleStockMany(req.targets.map((t) => t.id), req.delta, req.reason);
      const sign = req.delta > 0 ? "+" : "";
      announceListWrite({
        title: `${sign}${req.delta} on ${plural(count, "model")}`,
        undoneTitle: "Stock restored",
        performUndo: async () => {
          await writes.undoSaleStock(auditIds);
        },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not adjust stock" });
      throw e;
    }
  };

  const [reorderTargets, setReorderTargets] = React.useState<ReorderTarget[] | null>(null);
  const reorderFor = (ids: string[]): ReorderTarget[] =>
    ids.flatMap((id) => {
      const s = seen.current.get(id);
      return s ? [{ id, name: s.name, reorderLevel: s.reorderLevel }] : [];
    });

  /** ONE guarded Undo closure per write; the server refuses if a level changed since. */
  const setReorder = async (targets: ReorderTarget[], level: number | null) => {
    try {
      const r = await writes.setReorderLevels(targets.map((t) => ({ id: t.id, level })));
      if (r.count === 0) {
        toast.success("Nothing changed");
        return;
      }
      announceListWrite({
        title: level == null ? `Cleared the reorder level on ${plural(r.count, "model")}` : `Reorder level ${level} on ${plural(r.count, "model")}`,
        undoneTitle: "Reorder level restored",
        performUndo: async () => void (await writes.undoModelFieldEdits(r.auditIds)),
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not set the reorder level" });
      throw e;
    }
  };

  const exportRows = (ids: string[]) => {
    const rows = ids.flatMap((id) => {
      const s = seen.current.get(id);
      return s ? [[s.name, s.sku ?? "", String(s.onHand), String(s.reserved), String(s.available), s.reorderLevel != null ? String(s.reorderLevel) : "", s.salePrice != null ? String(s.salePrice) : ""]] : [];
    });
    downloadCsv(toCsv(["Item", "SKU", "On hand", "Reserved", "Available", "Reorder at", "Price"], rows), "sales-stock.csv");
  };

  const rows = items.map((s) =>
    saleStockRowOf(
      s,
      buildSaleStockActions({
        onOpenModel: () => router.push(`/assets/models/${s.id}`),
        onAdjust: canUpdate ? () => setTargets(targetsFor([s.id])) : undefined,
        onSetReorder: canUpdate ? () => setReorderTargets(reorderFor([s.id])) : undefined,
      }),
    ),
  );

  // `Reorder n low` only filters the list to the low-stock items; it is not a write (owner ruling 2026-11-24).
  const lowCount = (counts as Record<string, number> | undefined)?.low ?? 0;
  const primary: ListPrimary | undefined = lowCount > 0 ? { label: `Reorder ${lowCount} low`, onSelect: () => setState(withPatch(state, { seg: "low", page: 1 })) } : undefined;

  return (
    <>
      <ListPage
        spec={SALES_STOCK_SPEC}
        title="Sales stock"
        noun="items"
        bulkNoun="item"
        searchPlaceholder="Search name, maker, model number or SKU"
        segments={salesStockSegments(counts as Record<string, number> | undefined)}
        filters={salesStockFilters((categories ?? []).map((c) => ({ id: c.id, name: c.name })))}
        columns={SALES_STOCK_COLUMNS}
        columnsKey="sales-stock"
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={SALES_STOCK_ITEM_HEADER}
        itemSortKey={SALES_STOCK_ITEM_SORT_KEY}
        primary={primary}
        bulk={(ids) =>
          buildSaleStockBulkActions({
            onAdjust: canUpdate ? () => setTargets(targetsFor(ids)) : undefined,
            onSetReorder: canUpdate ? () => setReorderTargets(reorderFor(ids)) : undefined,
            onExport: () => exportRows(ids),
          })
        }
        empty={{ title: "No sale stock yet", description: "Give a model a sale price on its page and its new-stock pool appears here." }}
        toolbarExtra={<UrlSavedViewsMenu tableId="sales-stock" spec={SALES_STOCK_SPEC} state={state} setState={setState} />}
      />
      <SalesStockAdjustDialog targets={targets} onClose={() => setTargets(null)} onSubmit={adjust} />
      <ReorderLevelDialog targets={reorderTargets} onClose={() => setReorderTargets(null)} onSave={setReorder} />
    </>
  );
}
