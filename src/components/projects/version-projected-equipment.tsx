"use client";

import { Boxes } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useProjectVersion } from "@/components/projects/project-version-context";
import type { ProjectedCategory, ProjectedGroup, ProjectedLineItem } from "@/lib/project-version-projection";

/**
 * Read-only projection of the Equipment tab for a non-live version (design
 * doc §4.1/§4.2/§5.1). Fed entirely by `ProjectVersionContext`'s mapped
 * `projected.equipment` — the SAME mapper (`projectSnapshotEntries`) that
 * maps `currentEntries` for the parity test, never a hand-written second
 * shape (R-3.1).
 *
 * Sub-hire lines and category-slot ordering are not in `SnapshotEntityType`
 * (convex/lib/projectSnapshots.ts) — never captured by any snapshot, not a
 * bug in this render — so this view never claims to show them; the banner
 * below says so rather than silently omitting them with no explanation
 * (design doc §5.1: "a wrong number that looks right is worse than an
 * absent one").
 */

function LineItemRow({ item }: { item: ProjectedLineItem }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-2 pl-6 text-ui-text first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-ink-2">
        {item.quantity}× {item.description || "Untitled item"}
      </span>
      <span className="shrink-0 tabular-nums text-ink-2">{formatCurrency(item.unitPrice * item.quantity)}</span>
    </div>
  );
}

function GroupBlock({ group }: { group: ProjectedGroup }) {
  return (
    <div className="border-t border-line py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3 text-ui-text font-semibold text-ink">
        <span className="min-w-0 flex-1 truncate">{group.title || "Untitled group"}</span>
        <span className="shrink-0 tabular-nums">{group.price != null ? formatCurrency(group.price) : "—"}</span>
      </div>
      {group.lineItems.map((li) => (
        <LineItemRow key={li.id} item={li} />
      ))}
    </div>
  );
}

function CategoryBlock({ category }: { category: ProjectedCategory }) {
  const isEmpty = category.groups.length === 0 && category.ungroupedLineItems.length === 0;
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
      <h3 className="text-card-title font-bold text-ink">{category.name || "Untitled category"}</h3>
      {isEmpty ? (
        <p className="mt-2 text-caption text-muted">No equipment in this category.</p>
      ) : (
        <div className="mt-1">
          {category.groups.map((g) => (
            <GroupBlock key={g.id} group={g} />
          ))}
          {category.ungroupedLineItems.map((li) => (
            <LineItemRow key={li.id} item={li} />
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionProjectedEquipment() {
  const { projected, isLoadingProjection, viewingRevision } = useProjectVersion();

  if (isLoadingProjection) {
    return <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">Loading v{viewingRevision}…</div>;
  }
  if (!projected) return null;

  const { categories, uncategorizedGroups, uncategorizedLineItems } = projected.equipment;
  const isEmpty = categories.length === 0 && uncategorizedGroups.length === 0 && uncategorizedLineItems.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-[var(--r)] border border-line bg-card px-3 py-2 text-caption text-muted">
        <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Sub-hires and custom item ordering aren&apos;t captured in this version — not shown here. Prices,
          quantities and grouping are as of v{viewingRevision}.
        </span>
      </div>

      {isEmpty ? (
        <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">
          No equipment captured for v{viewingRevision}.
        </div>
      ) : (
        <>
          {categories.map((c) => (
            <CategoryBlock key={c.id} category={c} />
          ))}
          {(uncategorizedGroups.length > 0 || uncategorizedLineItems.length > 0) && (
            <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
              <h3 className="text-card-title font-bold text-ink">Uncategorized</h3>
              <div className="mt-1">
                {uncategorizedGroups.map((g) => (
                  <GroupBlock key={g.id} group={g} />
                ))}
                {uncategorizedLineItems.map((li) => (
                  <LineItemRow key={li.id} item={li} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
