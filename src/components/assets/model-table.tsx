"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Plus,
  Download,
  Upload,
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Ruler,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import { useModelWrites } from "@/hooks/use-model-writes";
import { useModels } from "@/hooks/use-models";
import { useModelCounts } from "@/hooks/use-model-counts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DollarSign } from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { exportModelsCSV } from "@/server/csv";
import { useCheckItemWrites } from "@/hooks/use-check-item-writes";
import { useCheckItems } from "@/hooks/use-check-items";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Record<string, any>;

type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";

const TYPE_LABELS: Record<CheckItemType, string> = {
  PASS_FAIL: "Pass / fail",
  NOTES: "Notes",
  MEASUREMENT: "Measurement",
  DROPDOWN: "Dropdown",
};

const TYPE_ICONS: Record<CheckItemType, typeof CheckCircle2> = {
  PASS_FAIL: CheckCircle2,
  NOTES: FileText,
  MEASUREMENT: Ruler,
  DROPDOWN: ListChecks,
};

// Badge status intent per check-item type — mirrors model-checks-tab.tsx so the
// chip colours come from the registry Badge, not a hand-rolled palette map.
const TYPE_STATUS: Record<CheckItemType, "ok" | "warn" | "neutral"> = {
  PASS_FAIL: "ok",
  NOTES: "neutral",
  MEASUREMENT: "warn",
  DROPDOWN: "neutral",
};

function useModelColumns(
  categories: Array<{ id: string; name: string; parent?: { name: string } | null }>,
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
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl}
            alt={row.name}
            size={36}
          />
          <div>
            <Link href={`/assets/models/${row.id}`} className={cn("text-table-cell font-medium hover:underline hover:text-ink rounded-[var(--r)]", focusRing)} onClick={(e) => e.stopPropagation()}>
              {row.name}
            </Link>
            {row.modelNumber && (
              <span className="ml-2 t-mono text-muted">{row.modelNumber}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "manufacturer",
      header: "Manufacturer",
      accessorKey: "manufacturer",
      sortKey: "manufacturer",
      mobile: "subtitle",
      cell: (row) => (
        <span className="text-muted">{row.manufacturer || "\u2014"}</span>
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
        label: cat.parent ? `${cat.parent.name} \u2192 ${cat.name}` : cat.name,
      })),
      // Category + Type both render Badge chips \u2014 pair them top-right of the card.
      mobile: "badge",
      cell: (row) =>
        row.category ? (
          <Badge status="neutral">{row.category.name}</Badge>
        ) : (
          <span className="text-muted">{"\u2014"}</span>
        ),
    },
    {
      id: "assetType",
      header: "Type",
      accessorKey: "assetType",
      sortKey: "assetType",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "SERIALIZED", label: "Serialized" },
        { value: "BULK", label: "Bulk" },
      ],
      mobile: "badge",
      cell: (row) => (
        <Badge status="neutral">
          {row.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
        </Badge>
      ),
    },
    {
      id: "assetCount",
      header: "Assets",
      sortable: false,
      align: "right",
      mobile: "meta",
      cell: (row) => (
        <span className="t-data tabular-nums text-ink">
          {row._count.assets + row._count.bulkAssets}
        </span>
      ),
    },
    {
      id: "dailyRate",
      header: "Daily rate",
      accessorKey: "dailyRate",
      sortKey: "dailyRate",
      align: "right",
      mobile: "meta",
      cell: (row) => {
        const hasDaily = row.dailyRate != null;
        const hasWeekly = row.weeklyRate != null;
        const hasMonthly = row.monthlyRate != null;
        const rateCount = [hasDaily, hasWeekly, hasMonthly].filter(Boolean).length;

        return (
          <div className="flex items-center justify-end gap-2">
            {rateCount === 3 ? (
              <span className="inline-block h-2 w-2 rounded-full bg-ok" aria-label="Pricing complete" title="Pricing complete" />
            ) : rateCount > 0 ? (
              <span className="inline-block h-2 w-2 rounded-full bg-warn" aria-label="Pricing incomplete" title="Pricing incomplete" />
            ) : null}
            <span className="t-data tabular-nums text-ink">
              {hasDaily ? `$${Number(row.dailyRate).toFixed(2)}` : "\u2014"}
            </span>
          </div>
        );
      },
    },
    {
      id: "tags",
      header: "Tags",
      sortable: false,
      defaultVisible: true,
      responsiveHide: "lg",
      // Long tag lists blow out the card — noise on a phone.
      mobile: "hidden",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.tags?.map((tag: string) => (
            <Badge key={tag} status="neutral">
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
  ];
}

export function ModelTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("models", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [ratesImportOpen, setRatesImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignChecksOpen, setAssignChecksOpen] = useState(false);
  const [bulkRatesOpen, setBulkRatesOpen] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive categories (Convex) with synthetic parent name, sorted to match the
  // old getCategories() order. Used for the filter dropdown + per-row category
  // label resolution. Memoize the empty-list fallback so the reference stays
  // stable across renders (it feeds the models useMemo below).
  const categoriesWithParent = useCategoriesWithParent(orgId);
  const categories = useMemo(() => categoriesWithParent ?? [], [categoriesWithParent]);

  const columns = useModelColumns(categories);

  // Reactive model list straight from Convex (auto-updates on any model
  // create/update/archive). Asset/bulk counts + the primary photo are
  // cross-domain (assets + model media still live in Prisma) so they come from a
  // separate, non-reactive server query and are merged in below.
  const allModels = useModels(orgId);
  const modelCounts = useModelCounts(orgId);

  // Filter (active only + search name/manufacturer/modelNumber/sku + category +
  // assetType) → sort → paginate, all client-side over the reactive list. The
  // Convex list returns ALL models including archived, so re-apply isActive.
  // Category, counts, and primary media are merged in (cross-domain).
  const { models, total } = useMemo(() => {
    const source = allModels ?? [];
    const q = search.trim().toLowerCase();
    const categoryFilter = filters?.categoryId as string | undefined;
    const assetTypeFilter = filters?.assetType as string | undefined;
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const filtered = source.filter((m) => {
      if (m.isActive === false) return false;
      if (categoryFilter && m.categoryId !== categoryFilter) return false;
      if (assetTypeFilter && m.assetType !== assetTypeFilter) return false;
      if (q) {
        const hit =
          m.name.toLowerCase().includes(q) ||
          (m.manufacturer?.toLowerCase().includes(q) ?? false) ||
          (m.modelNumber?.toLowerCase().includes(q) ?? false) ||
          (m.sku?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortBy === "category"
        ? categoryById.get(a.categoryId ?? "")?.name
        : (a as Record<string, unknown>)[sortBy];
      const bv = sortBy === "category"
        ? categoryById.get(b.categoryId ?? "")?.name
        : (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const merged = sorted.map((m) => {
      const meta = modelCounts?.[m.id];
      const category = m.categoryId ? categoryById.get(m.categoryId) ?? null : null;
      return {
        ...m,
        category,
        _count: { assets: meta?.assets ?? 0, bulkAssets: meta?.bulkAssets ?? 0 },
        media: meta?.media ? [{ file: meta.media }] : [],
      };
    });

    const start = (page - 1) * pageSize;
    return { models: merged.slice(start, start + pageSize), total: merged.length };
  }, [allModels, modelCounts, categories, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allModels === undefined;

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAssignChecksOpen(false);
  };

  const toolbarActions = (
    <>
      <CanDo resource="model" action="create">
        <Button
          variant="line"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={async () => {
            const csv = await exportModelsCSV();
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "models.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
        <Button variant="line" size="sm" className="hidden sm:inline-flex" onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import
        </Button>
      </CanDo>
      <CanDo resource="model" action="update">
        <Button variant="line" size="sm" className="hidden sm:inline-flex" onClick={() => setRatesImportOpen(true)}>
          <DollarSign className="mr-2 h-4 w-4" />
          Import rates
        </Button>
      </CanDo>
      <CanDo resource="model" action="create">
        <Button size="sm" asChild>
          <Link href="/assets/models/new">
            <Plus className="mr-2 h-4 w-4" />
            New model
          </Link>
        </Button>
      </CanDo>
    </>
  );

  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--r)] border-2 border-line-2 bg-paper-2/50 px-4 py-2">
          <span className="text-ui-text font-medium text-ink tabular-nums">{selectedIds.size} selected</span>
          <CanDo resource="model" action="update">
            <Button size="sm" variant="line" onClick={() => setBulkRatesOpen(true)}>
              <DollarSign className="mr-2 h-3 w-3" />
              Set rates
            </Button>
          </CanDo>
          <CanDo resource="checkItem" action="update">
            <Button size="sm" variant="line" onClick={() => setAssignChecksOpen(true)}>
              <ClipboardCheck className="mr-2 h-3 w-3" />
              Assign checks
            </Button>
          </CanDo>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

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
        savedViews={{ tableId: "models", currentConfig, applyConfig }}
        isLoading={isLoading}
        emptyPreset="models"
        toolbarActions={toolbarActions}
        enableRowSelection
        selectedRows={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Mobile export/import buttons */}
      <div className="flex gap-2 sm:hidden">
        <CanDo resource="model" action="create">
          <Button
            variant="line"
            size="sm"
            onClick={async () => {
              const csv = await exportModelsCSV();
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "models.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="line" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        </CanDo>
        <CanDo resource="model" action="update">
          <Button variant="line" size="sm" onClick={() => setRatesImportOpen(true)}>
            <DollarSign className="mr-2 h-4 w-4" />
            Rates
          </Button>
        </CanDo>
      </div>

      <CSVImportDialog type="models" open={importOpen} onOpenChange={setImportOpen} />
      <CSVImportDialog type="rates" open={ratesImportOpen} onOpenChange={setRatesImportOpen} />

      <BulkRateUpdateDialog
        open={bulkRatesOpen}
        onOpenChange={setBulkRatesOpen}
        selectedModelIds={selectedIds}
        onSuccess={() => {
          // model-table is reactive (useModels) — the dual-write pushes updates.
          clearSelection();
        }}
      />

      <BulkAssignChecksDialog
        open={assignChecksOpen}
        onOpenChange={setAssignChecksOpen}
        selectedModelIds={selectedIds}
        onSuccess={() => {
          // model-table is reactive (useModels) — the dual-write pushes updates.
          clearSelection();
        }}
      />
    </div>
  );
}

// ─── Bulk Assign Checks Dialog ──────────────────────────────────────────────

function BulkAssignChecksDialog({
  open,
  onOpenChange,
  selectedModelIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelIds: Set<string>;
  onSuccess: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [selectedCheckIds, setSelectedCheckIds] = useState<Set<string>>(new Set());

  // Reactive: subscribe to the check-item library via Convex, only while the
  // dialog is open (mirrors the old `enabled: open`). Convex pushes any
  // create/update/delete from the settings page live.
  const allCheckItemsData = useCheckItems(open ? orgId : undefined);
  const allCheckItems = allCheckItemsData ?? [];
  const isLoading = allCheckItemsData === undefined;
  const writes = useCheckItemWrites();

  const mutation = useServerMutation({
    mutationFn: () =>
      writes.bulkAddCheckItemsToModels(
        Array.from(selectedModelIds),
        Array.from(selectedCheckIds)
      ),
    onSuccess: (result) => {
      const msg = result.count === 0
        ? "All selected checks were already assigned"
        : `Assigned checks to ${selectedModelIds.size} model${selectedModelIds.size !== 1 ? "s" : ""} (${result.count} new)`;
      toast.success(msg);
      setSelectedCheckIds(new Set());
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = allCheckItems as Record<string, unknown>[];

  // Group by category
  const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
    const cat = (item.category as string) || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
  const sortedCategories = Object.keys(grouped).sort((a, b) =>
    a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)
  );

  function toggleCheckItem(id: string) {
    setSelectedCheckIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedCheckIds.size === items.length) {
      setSelectedCheckIds(new Set());
    } else {
      setSelectedCheckIds(new Set(items.map((i) => i.id as string)));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setSelectedCheckIds(new Set());
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Assign checks to {selectedModelIds.size} model{selectedModelIds.size !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <p className="text-ui-text text-muted">
          Select check items to assign. Already-assigned items will be skipped.
        </p>

        {isLoading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-[var(--r)]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted">
            <ClipboardCheck className="mb-2 h-6 w-6 opacity-50" />
            <p className="text-ui-text">No check items in the library yet.</p>
            <Link
              href="/settings/check-items"
              className={cn("mt-2 text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}
            >
              Create check items in settings
            </Link>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-3">
            {/* Select all */}
            <button
              type="button"
              onClick={toggleAll}
              className={cn("flex w-full items-center gap-3 rounded-[var(--r)] px-3 py-2 text-left text-ui-text font-medium text-ink motion-safe:transition-colors hover:bg-elev", focusRing)}
            >
              <Checkbox
                checked={
                  selectedCheckIds.size === items.length
                    ? true
                    : selectedCheckIds.size > 0
                      ? "indeterminate"
                      : false
                }
              />
              <span>Select all ({items.length})</span>
            </button>

            <div className="h-px bg-line" />

            {sortedCategories.map((category) => (
              <div key={category}>
                <p className="px-3 t-overline text-muted mb-1">
                  {category}
                </p>
                {grouped[category].map((item) => {
                  const type = item.type as CheckItemType;
                  const Icon = TYPE_ICONS[type];
                  const isSelected = selectedCheckIds.has(item.id as string);
                  return (
                    <button
                      key={item.id as string}
                      type="button"
                      onClick={() => toggleCheckItem(item.id as string)}
                      className={cn("flex w-full items-center gap-3 rounded-[var(--r)] px-3 py-2 text-left motion-safe:transition-colors hover:bg-elev", focusRing)}
                    >
                      <Checkbox checked={isSelected} />
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="text-ui-text font-medium text-ink truncate">
                          {item.label as string}
                        </p>
                      </div>
                      <Badge status={TYPE_STATUS[type]} className="shrink-0">
                        {TYPE_LABELS[type]}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={selectedCheckIds.size === 0}
          >
            Assign {selectedCheckIds.size} check{selectedCheckIds.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Rate Update Dialog ──────────────────────────────────────────────

function BulkRateUpdateDialog({
  open,
  onOpenChange,
  selectedModelIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelIds: Set<string>;
  onSuccess: () => void;
}) {
  const [rateType, setRateType] = useState<"dailyRate" | "weeklyRate" | "monthlyRate" | "salePrice">("dailyRate");
  const [operation, setOperation] = useState<"set" | "multiply" | "increase_percent">("set");
  const [value, setValue] = useState("");
  const modelWrites = useModelWrites();

  const rateTypeLabels: Record<string, string> = {
    dailyRate: "Daily rate",
    weeklyRate: "Weekly rate",
    monthlyRate: "Monthly rate",
    // WS11 (#950) — sales items.
    salePrice: "Sale price",
  };

  const operationLabels: Record<string, string> = {
    set: "Set fixed amount",
    multiply: "Multiply by factor",
    increase_percent: "Increase by %",
  };

  const mutation = useServerMutation({
    mutationFn: () =>
      modelWrites.bulkUpdateRates(
        Array.from(selectedModelIds),
        rateType,
        operation,
        Number(value)
      ),
    onSuccess: (result) => {
      toast.success(`Updated ${rateTypeLabels[rateType]} on ${result.count} model${result.count !== 1 ? "s" : ""}`);
      setValue("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set rates — {selectedModelIds.size} model{selectedModelIds.size !== 1 ? "s" : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Rate type</Label>
            <Select value={rateType} onValueChange={(v) => setRateType(v as typeof rateType)}>
              <SelectTrigger>
                <SelectValue>{rateTypeLabels[rateType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dailyRate">Daily rate</SelectItem>
                <SelectItem value="weeklyRate">Weekly rate</SelectItem>
                <SelectItem value="monthlyRate">Monthly rate</SelectItem>
                <SelectItem value="salePrice">Sale price</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Operation</Label>
            <Select value={operation} onValueChange={(v) => setOperation(v as typeof operation)}>
              <SelectTrigger>
                <SelectValue>{operationLabels[operation]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Set fixed amount</SelectItem>
                <SelectItem value="multiply">Multiply by factor</SelectItem>
                <SelectItem value="increase_percent">Increase by %</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {operation === "set" ? "Amount ($)" : operation === "multiply" ? "Factor" : "Percentage (%)"}
            </Label>
            <Input
              type="number"
              step={operation === "set" ? "0.01" : "0.1"}
              min={operation === "set" ? "0" : operation === "multiply" ? "0.01" : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={operation === "set" ? "e.g. 100.00" : operation === "multiply" ? "e.g. 1.1" : "e.g. 10"}
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
            disabled={!value || Number(value) === 0}
          >
            {mutation.isPending ? `Updating ${selectedModelIds.size} models...` : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
