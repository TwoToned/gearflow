"use client";

import { Search } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { packingFiltersActive, type PackingFilters, type PackingStatusFilter } from "@/lib/packing-tab";

const ALL = "__all";

const STATUS_LABELS: Record<PackingStatusFilter, string> = {
  all: "Status",
  planned: "Planned",
  packed: "Packed",
  unplanned: "Unplanned",
};

/**
 * The Packing toolbar (§7b.2): a bare search, `Category ▾` and `Status ▾`
 * filter words that read their value, `Clear` and the tab ⋯. The tab's `+ Add
 * case` is the TAB ROW's primary (`PackingTabPrimary`, outline); the phone gets
 * the red sticky bar in the tab body, replaced by the bulk bar while anything is
 * ticked.
 */
export function PackingToolbar({
  filters,
  onFilters,
  categories,
  tabMenu,
}: {
  filters: PackingFilters;
  onFilters: (next: PackingFilters) => void;
  categories: readonly string[];
  /** Print all labels, Manifest, Select the unplanned, Show every line, Open the warehouse page. On a
   *  phone it is the same ⋯, opening as a 48 px bottom sheet, so none of these is lost there. */
  tabMenu: ActionMenuSpec;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1 md:max-w-64">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          type="search"
          value={filters.search}
          onChange={(e) => onFilters({ ...filters, search: e.target.value })}
          placeholder="Search lines"
          aria-label="Search lines"
          className="pl-8 text-base md:text-ui-text"
        />
      </div>

      <Select value={filters.category ?? ALL} onValueChange={(v) => onFilters({ ...filters, category: v === ALL ? null : v })}>
        <SelectTrigger aria-label="Category" className="w-auto min-w-28">
          <SelectValue>{filters.category ?? "Category"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => onFilters({ ...filters, status: v as PackingStatusFilter })}>
        <SelectTrigger aria-label="Status" className="w-auto min-w-28">
          <SelectValue>{STATUS_LABELS[filters.status]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          <SelectItem value="planned">Planned</SelectItem>
          <SelectItem value="packed">Packed</SelectItem>
          <SelectItem value="unplanned">Unplanned</SelectItem>
        </SelectContent>
      </Select>

      {packingFiltersActive(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onFilters({ search: "", category: null, status: "all" })}>
          Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-1">
        {tabMenu.items.length > 0 && <ActionMenu spec={tabMenu} label="Packing actions" />}
      </div>
    </div>
  );
}
