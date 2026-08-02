"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useModelWrites } from "@/hooks/use-model-writes";
import { useModels } from "@/hooks/use-models";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Record<string, any>;

function matchesSearch(m: AnyModel, q: string): boolean {
  return (
    m.name.toLowerCase().includes(q) ||
    (m.manufacturer?.toLowerCase().includes(q) ?? false) ||
    (m.sku?.toLowerCase().includes(q) ?? false)
  );
}

/** Resolves a row's value for the active sort key — category/stock need a lookup
 *  or a default, everything else reads straight off the row. */
function sortValue(row: AnyModel, sortBy: string, categoryById: Map<string, { name: string }>): unknown {
  if (sortBy === "category") return categoryById.get(row.categoryId ?? "")?.name;
  if (sortBy === "saleStockQuantity") return row.saleStockQuantity ?? 0;
  return row[sortBy];
}

/**
 * WS11 (#950) follow-up — a management view over `Model.saleStockQuantity`
 * (the NEW_STOCK sale-stock pool, see FEATUREDOCS/67). Every model is
 * sellable, so this lists the whole active catalogue rather than filtering to
 * models that already have stock set — the point is to let an operator SET it
 * in the first place. Complements, rather than duplicates, the Overbookings
 * board's "Sale stock to procure" section: that's a reactive alert for models
 * already oversold, this is the general-purpose view + restock action for
 * every model, healthy or not.
 */
function useSalesStockColumns(
  categories: Array<{ id: string; name: string; parent?: { name: string } | null }>,
  onRestock: (model: AnyModel) => void,
): ColumnDef<AnyModel>[] {
  return [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      alwaysVisible: true,
      sortKey: "name",
      mobile: "title",
      cell: (row) => (
        <div>
          <Link
            href={`/assets/models/${row.id}`}
            className={cn("text-table-cell font-medium hover:underline hover:text-ink rounded-[var(--r)]", focusRing)}
            onClick={(e) => e.stopPropagation()}
          >
            {row.name}
          </Link>
          {row.sku && <span className="ml-2 t-mono text-muted">{row.sku}</span>}
        </div>
      ),
    },
    {
      id: "categoryId",
      header: "Category",
      sortKey: "category",
      filterable: true,
      filterType: "enum",
      filterOptions: categories.map((cat) => ({
        value: cat.id,
        label: cat.parent ? `${cat.parent.name} → ${cat.name}` : cat.name,
      })),
      mobile: "badge",
      cell: (row) =>
        row.category ? (
          <Badge status="neutral">{row.category.name}</Badge>
        ) : (
          <span className="text-muted">{"—"}</span>
        ),
    },
    {
      id: "salePrice",
      header: "Sale price",
      accessorKey: "salePrice",
      sortKey: "salePrice",
      align: "right",
      mobile: "meta",
      cell: (row) => (
        <span className="t-data tabular-nums text-ink">
          {row.salePrice != null ? `$${Number(row.salePrice).toFixed(2)}` : "—"}
        </span>
      ),
    },
    {
      id: "saleStockQuantity",
      header: "Sale stock",
      sortKey: "saleStockQuantity",
      align: "right",
      mobile: "meta",
      cell: (row) => {
        const qty = row.saleStockQuantity ?? 0;
        if (qty < 0) {
          return (
            <Badge status="overbooked" className="tabular-nums">
              {qty} — oversold
            </Badge>
          );
        }
        return <span className="t-data tabular-nums text-ink">{qty}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      align: "right",
      mobile: "actions",
      cell: (row) => (
        <CanDo resource="model" action="update">
          <Button
            variant="line"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onRestock(row);
            }}
          >
            <PackagePlus className="mr-2 h-3.5 w-3.5" />
            Restock
          </Button>
        </CanDo>
      ),
    },
  ];
}

export function SalesStockTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("sales-stock", { sortBy: "saleStockQuantity", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [restockTarget, setRestockTarget] = useState<AnyModel | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const categoriesWithParent = useCategoriesWithParent(orgId);
  const categories = useMemo(() => categoriesWithParent ?? [], [categoriesWithParent]);

  const columns = useSalesStockColumns(categories, setRestockTarget);

  const allModels = useModels(orgId);

  const { models, total } = useMemo(() => {
    const source = allModels ?? [];
    const q = search.trim().toLowerCase();
    const categoryFilter = filters?.categoryId as string | undefined;
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const filtered = source.filter((m) => {
      if (m.isActive === false) return false;
      if (categoryFilter && m.categoryId !== categoryFilter) return false;
      if (q && !matchesSearch(m, q)) return false;
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortBy, categoryById);
      const bv = sortValue(b, sortBy, categoryById);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const merged = sorted.map((m) => ({
      ...m,
      category: m.categoryId ? categoryById.get(m.categoryId) ?? null : null,
    }));

    const start = (page - 1) * pageSize;
    return { models: merged.slice(start, start + pageSize), total: merged.length };
  }, [allModels, categories, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allModels === undefined;

  return (
    <div className="space-y-4">
      <DataTable
        data={models}
        columns={columns}
        totalRows={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sortField={sortBy}
        sortDirection={sortOrder}
        onSortChange={handleSort}
        filters={filters}
        onFilterChange={setFilter}
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search models..."
        columnVisibility={columnVisibility}
        onToggleColumnVisibility={toggleColumnVisibility}
        onResetPreferences={resetPreferences}
        savedViews={{ tableId: "sales-stock", currentConfig, applyConfig }}
        isLoading={isLoading}
        emptyTitle="No models yet"
        emptyDescription="Create a model in Assets → Models to start tracking sale stock."
      />

      <RestockDialog
        model={restockTarget}
        open={restockTarget != null}
        onOpenChange={(v) => { if (!v) setRestockTarget(null); }}
      />
    </div>
  );
}

// ─── Restock Dialog ──────────────────────────────────────

function RestockDialog({
  model,
  open,
  onOpenChange,
}: {
  model: AnyModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const modelWrites = useModelWrites();

  const mutation = useServerMutation({
    mutationFn: () => {
      if (!model) throw new Error("No model selected");
      const parsed = Math.trunc(Number(delta));
      return modelWrites.adjustSaleStock(model.id, parsed, reason.trim() || undefined);
    },
    onSuccess: (result) => {
      toast.success(`${model?.name} sale stock is now ${result.saleStockQuantity}`);
      setDelta("");
      setReason("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const parsedDelta = Math.trunc(Number(delta));
  const canSubmit = delta.trim() !== "" && Number.isFinite(parsedDelta) && parsedDelta !== 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { setDelta(""); setReason(""); }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust sale stock — {model?.name}</DialogTitle>
          <DialogDescription>
            Current pool: {model?.saleStockQuantity ?? 0}. Enter a positive number for stock
            received, or a negative number to correct it down (e.g. a stocktake or damage
            write-off).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="sale-stock-delta">Quantity</Label>
            <Input
              id="sale-stock-delta"
              type="number"
              step="1"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 20, or -3 to correct down"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sale-stock-reason">Reason (optional)</Label>
            <Textarea
              id="sale-stock-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Received PO #1234"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
