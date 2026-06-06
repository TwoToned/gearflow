"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Download,
  Upload,
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  FileText,
  Ruler,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

import { getModels, bulkUpdateRates } from "@/server/models";
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
import { getCategories } from "@/server/categories";
import { exportModelsCSV } from "@/server/csv";
import { getCheckItems, bulkAddCheckItemsToModels } from "@/server/check-items";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  PASS_FAIL: "Pass / Fail",
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

const TYPE_COLORS: Record<CheckItemType, string> = {
  PASS_FAIL: "bg-green-500/10 text-green-500 border-green-500/20",
  NOTES: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  MEASUREMENT: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  DROPDOWN: "bg-purple-500/10 text-purple-500 border-purple-500/20",
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
      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl}
            alt={row.name}
            size={36}
          />
          <div>
            <Link href={`/assets/models/${row.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.name}
            </Link>
            {row.modelNumber && (
              <span className="ml-2 text-xs text-fg-3">{row.modelNumber}</span>
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
      cell: (row) => (
        <span className="text-fg-3">{row.manufacturer || "\u2014"}</span>
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
      cell: (row) =>
        row.category ? (
          <Badge variant="secondary">{row.category.name}</Badge>
        ) : (
          <span className="text-fg-3">{"\u2014"}</span>
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
      cell: (row) => (
        <Badge variant={row.assetType === "SERIALIZED" ? "default" : "outline"}>
          {row.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
        </Badge>
      ),
    },
    {
      id: "assetCount",
      header: "Assets",
      sortable: false,
      align: "right",
      cell: (row) => row._count.assets + row._count.bulkAssets,
    },
    {
      id: "dailyRate",
      header: "Daily Rate",
      accessorKey: "dailyRate",
      sortKey: "dailyRate",
      align: "right",
      cell: (row) => {
        const hasDaily = row.dailyRate != null;
        const hasWeekly = row.weeklyRate != null;
        const hasMonthly = row.monthlyRate != null;
        const rateCount = [hasDaily, hasWeekly, hasMonthly].filter(Boolean).length;

        return (
          <div className="flex items-center justify-end gap-2">
            {rateCount === 3 ? (
              <span className="inline-block h-2 w-2 rounded-full bg-teal-500" aria-label="Pricing complete" />
            ) : rateCount > 0 ? (
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-label="Pricing incomplete" />
            ) : null}
            <span className="t-data">
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
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.tags?.map((tag: string) => (
            <Badge key={tag} variant="secondary" className="text-xs">
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
  const queryClient = useQueryClient();

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
  });

  const columns = useModelColumns(categories);

  const { data, isLoading } = useQuery({
    queryKey: ["models", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () =>
      getModels({
        search: search || undefined,
        filters,
        page,
        pageSize,
        sortBy,
        sortOrder,
      }),
  });

  const models = data?.models || [];
  const total = data?.total || 0;

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAssignChecksOpen(false);
  };

  const toolbarActions = (
    <>
      <CanDo resource="model" action="create">
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex h-8"
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
        <Button variant="outline" size="sm" className="hidden sm:inline-flex h-8" onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import
        </Button>
      </CanDo>
      <CanDo resource="model" action="update">
        <Button variant="outline" size="sm" className="hidden sm:inline-flex h-8" onClick={() => setRatesImportOpen(true)}>
          <DollarSign className="mr-2 h-4 w-4" />
          Import Rates
        </Button>
      </CanDo>
      <CanDo resource="model" action="create">
        <Button size="sm" className="h-8" render={<Link href="/assets/models/new" />}>
          <Plus className="mr-2 h-4 w-4" />
          New Model
        </Button>
      </CanDo>
    </>
  );

  return (
    <div className="space-y-4">
      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-bg-inset/50 px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <CanDo resource="model" action="update">
            <Button size="sm" variant="outline" onClick={() => setBulkRatesOpen(true)}>
              <DollarSign className="mr-2 h-3 w-3" />
              Set Rates
            </Button>
          </CanDo>
          <CanDo resource="checkItem" action="update">
            <Button size="sm" variant="outline" onClick={() => setAssignChecksOpen(true)}>
              <ClipboardCheck className="mr-2 h-3 w-3" />
              Assign Checks
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
            variant="outline"
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
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        </CanDo>
        <CanDo resource="model" action="update">
          <Button variant="outline" size="sm" onClick={() => setRatesImportOpen(true)}>
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
          clearSelection();
          queryClient.invalidateQueries({ queryKey: ["models"] });
        }}
      />

      <BulkAssignChecksDialog
        open={assignChecksOpen}
        onOpenChange={setAssignChecksOpen}
        selectedModelIds={selectedIds}
        onSuccess={() => {
          clearSelection();
          queryClient.invalidateQueries({ queryKey: ["models"] });
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

  const { data: allCheckItems = [], isLoading } = useQuery({
    queryKey: ["check-items", orgId],
    queryFn: () => getCheckItems(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      bulkAddCheckItemsToModels(
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
            Assign Checks to {selectedModelIds.size} Model{selectedModelIds.size !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-fg-3">
          Select check items to assign. Already-assigned items will be skipped.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-fg-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-fg-3">
            <ClipboardCheck className="mb-2 h-6 w-6 opacity-50" />
            <p className="text-sm">No check items in library yet.</p>
            <Link
              href="/settings/check-items"
              className="mt-2 text-xs text-primary hover:underline"
            >
              Create check items in Settings
            </Link>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-3">
            {/* Select all */}
            <button
              type="button"
              onClick={toggleAll}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-bg-elevated"
            >
              <Checkbox
                checked={selectedCheckIds.size === items.length}
                indeterminate={selectedCheckIds.size > 0 && selectedCheckIds.size < items.length}
              />
              <span>Select all ({items.length})</span>
            </button>

            <div className="h-px bg-border" />

            {sortedCategories.map((category) => (
              <div key={category}>
                <p className="px-3 text-xs font-medium text-fg-3 uppercase tracking-wide mb-1">
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
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-bg-elevated"
                    >
                      <Checkbox checked={isSelected} />
                      <Icon className="h-4 w-4 shrink-0 text-fg-3" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {item.label as string}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] ${TYPE_COLORS[type]}`}
                      >
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || selectedCheckIds.size === 0}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assign {selectedCheckIds.size} Check{selectedCheckIds.size !== 1 ? "s" : ""}
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
  const [rateType, setRateType] = useState<"dailyRate" | "weeklyRate" | "monthlyRate">("dailyRate");
  const [operation, setOperation] = useState<"set" | "multiply" | "increase_percent">("set");
  const [value, setValue] = useState("");

  const rateTypeLabels: Record<string, string> = {
    dailyRate: "Daily Rate",
    weeklyRate: "Weekly Rate",
    monthlyRate: "Monthly Rate",
  };

  const operationLabels: Record<string, string> = {
    set: "Set fixed amount",
    multiply: "Multiply by factor",
    increase_percent: "Increase by %",
  };

  const mutation = useMutation({
    mutationFn: () =>
      bulkUpdateRates(
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
          <DialogTitle>Set Rates — {selectedModelIds.size} model{selectedModelIds.size !== 1 ? "s" : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Rate Type</Label>
            <Select value={rateType} onValueChange={(v) => setRateType(v as typeof rateType)}>
              <SelectTrigger>
                <SelectValue>{rateTypeLabels[rateType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dailyRate">Daily Rate</SelectItem>
                <SelectItem value="weeklyRate">Weekly Rate</SelectItem>
                <SelectItem value="monthlyRate">Monthly Rate</SelectItem>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !value || Number(value) === 0}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mutation.isPending ? `Updating ${selectedModelIds.size} models...` : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
