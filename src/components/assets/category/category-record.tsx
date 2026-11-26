"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { CategorySheetHost } from "@/components/assets/category/category-sheet-host";
import { Facts, Headline, RecordRows, RecordShell, type RecordRow, type RecordTab } from "@/components/people/record-shell";
import { Button } from "@/components/ui/button";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import { useCategoryWrites } from "@/hooks/use-category-writes";
import { categoryStateWord, modelsWithoutRates, subtreeIds, type CategoryCounts } from "@/lib/category-record-facts";
import { categorySheetInitialOf } from "@/lib/category-sheet";
import { announceListWrite } from "@/lib/list-write-toast";
import { buildCategoryRecordActions } from "@/lib/row-actions/category-record";
import { showError } from "@/lib/show-error";
import { equipmentClassLabels } from "@/lib/status-labels";
import { useCanDo } from "@/lib/use-permissions";
import { api } from "../../../../convex/_generated/api";

/** The category as `categories.detail` returns it (the parts this page reads). */
interface CategoryDetail {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  tags?: string[] | null;
  parentId?: string | null;
  xeroAccountCode?: string | null;
  defaultEquipmentClass?: string | null;
  defaultTestIntervalMonths?: number | null;
  parent: { id: string; name: string } | null;
  children: { id: string; name: string; icon?: string | null; _count: { models: number; kits: number; children: number } }[];
  kits: { id: string; name: string; assetTag?: string | null; _count?: { serializedItems: number; bulkItems: number } }[];
  models: { id: string; name: string; manufacturer?: string | null; modelNumber?: string | null; dailyRate?: number | null; weeklyRate?: number | null; _count: { assets: number } }[];
  _count: CategoryCounts;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function modelRowOf(m: CategoryDetail["models"][number]): RecordRow {
  const unrated = m.dailyRate == null && m.weeklyRate == null;
  return {
    id: m.id,
    title: m.name,
    href: `/assets/models/${m.id}`,
    meta: [m.manufacturer, m.modelNumber, plural(m._count.assets, "asset")].filter(Boolean),
    status: unrated ? { label: "No rate", intent: "warning" } : undefined,
  };
}

const kitRowOf = (k: CategoryDetail["kits"][number]): RecordRow => ({
  id: k.id, title: k.name, href: `/kits/${k.id}`, meta: [k.assetTag, plural((k._count?.serializedItems ?? 0) + (k._count?.bulkItems ?? 0), "item")].filter(Boolean),
});

const childRowOf = (c: CategoryDetail["children"][number]): RecordRow => ({
  id: c.id, title: `${c.icon ? `${c.icon} ` : ""}${c.name}`, href: `/assets/categories/${c.id}`,
  meta: [plural(c._count.models, "model"), c._count.kits > 0 ? plural(c._count.kits, "kit") : null, c._count.children > 0 ? `${c._count.children} below` : null].filter(Boolean),
});

/** What its own models inherit: the category's default T&T class and interval, in words. */
function testDefaultsText(c: CategoryDetail): string | null {
  const parts = [
    c.defaultEquipmentClass ? (equipmentClassLabels[c.defaultEquipmentClass] ?? c.defaultEquipmentClass) : null,
    c.defaultTestIntervalMonths ? `every ${plural(c.defaultTestIntervalMonths, "month")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function Overview({ c, unrated }: { c: CategoryDetail; unrated: number }) {
  const word = categoryStateWord(c._count, unrated);
  const defaults = testDefaultsText(c);
  return (
    <div className="flex flex-col gap-8">
      <Headline sub={c.description || undefined}>{word.label}</Headline>
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Contents" facts={[{ label: "Models", value: c._count.models }, { label: "Kits", value: c._count.kits }, { label: "Subcategories", value: c._count.children }]} />
        <Facts title="Place" facts={[{ label: "Parent", value: c.parent ? <Link className="hover:underline" href={`/assets/categories/${c.parent.id}`}>{c.parent.name}</Link> : "Top level" }, { label: "Tags", value: c.tags?.join(", ") }]} />
        <Facts title="Test & tag defaults" facts={[{ label: "Default", value: defaults ?? "None set" }, { label: "Applies to", value: "Its own models, unless a model sets its own" }]} />
      </div>
    </div>
  );
}

/** Retire-free Delete: models and kits to Uncategorised, subcategories up; the toast carries the exact Undo. */
function useDeleteCategory(c: CategoryDetail | null | undefined) {
  const router = useRouter();
  const writes = useCategoryWrites();
  return async () => {
    if (!c) return;
    try {
      const r = await writes.deleteMoving(c.id);
      announceListWrite({ title: `Deleted ${c.name}`, undoneTitle: `Restored ${c.name}`, performUndo: async () => void (await writes.undoDelete(c.id, r.auditId)) });
      router.push(c.parent ? `/assets/categories/${c.parent.id}` : "/assets/categories");
    } catch (e) {
      showError(e, { fallbackTitle: "Could not delete the category" });
    }
  };
}

function RecordBody({ c, includeSub, setIncludeSub, orgId }: { c: CategoryDetail; includeSub: boolean; setIncludeSub: (v: boolean) => void; orgId: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canUpdate = useCanDo("model", "update");
  const canDelete = useCanDo("model", "delete");
  const allCategories = useCategories(orgId) ?? [];
  const remove = useDeleteCategory(c);
  const unrated = modelsWithoutRates(c.models);
  const word = categoryStateWord(c._count, unrated);
  const edit = canUpdate
    ? () => {
        const q = new URLSearchParams(params.toString());
        q.set("edit", "1");
        router.push(`${pathname}?${q.toString()}`);
      }
    : undefined;
  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: <Overview c={c} unrated={unrated} /> },
    {
      value: "models", label: "Models", count: c.models.length,
      panel: (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-muted" aria-pressed={includeSub} onClick={() => setIncludeSub(!includeSub)}>
              {includeSub ? "Including subcategories ✕" : "Including subcategories"}
            </Button>
            {canUpdate ? <Button variant="ghost" size="sm" className="text-muted" asChild><Link href="/assets/models/new">Add model</Link></Button> : null}
          </div>
          <RecordRows noun="model" empty={includeSub ? "No models in this category or below it." : "No models in this category."} rows={c.models.map(modelRowOf)} />
        </div>
      ),
    },
    { value: "kits", label: "Kits", count: c.kits.length, panel: <RecordRows noun="kit" empty="No kits in this category." rows={c.kits.map(kitRowOf)} /> },
    { value: "subcategories", label: "Subcategories", count: c.children.length, panel: <RecordRows noun="subcategory" empty="No subcategories." rows={c.children.map(childRowOf)} /> },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="category" entityId={c.id} limit={25} /> },
  ];
  return (
    <>
      <RecordShell
        crumb={{ label: "Categories", href: "/assets/categories" }}
        title={`${c.icon ? `${c.icon} ` : ""}${c.name}`}
        status={{ label: word.label, intent: word.intent, outline: word.outline }}
        meta={[c.parent?.name ?? "Top level", plural(c._count.models, "model"), plural(c._count.kits, "kit")]}
        onEdit={edit}
        menu={buildCategoryRecordActions({ name: c.name, counts: c._count, parentName: c.parent?.name ?? null, onDelete: canDelete ? () => void remove() : undefined })}
        tabs={tabs}
        rail={<Facts title="At a glance" facts={[{ label: "Parent", value: c.parent?.name ?? "Top level" }, { label: "Test & tag", value: testDefaultsText(c) ?? "No default" }, { label: "Models", value: c._count.models }, { label: "Kits", value: c._count.kits }]} />}
      />
      <CategorySheetHost category={categorySheetInitialOf(c)} excludedParentIds={subtreeIds(allCategories, c.id)} />
    </>
  );
}

/**
 * The gear Category record (UX Phase 14, 14b-5, section 9n): header word (`2 models without rates`, `12 models`, `Empty`),
 * Overview, Models (with `Including subcategories`), Kits, Subcategories and History, with Edit the real sheet and Delete in
 * the menu (models and kits to Uncategorised, subcategories up, an exact Undo). The category's default Test & tag class and
 * interval are inherited by its OWN models (D77).
 */
export function CategoryRecord({ id, orgId }: { id: string; orgId: string | undefined }) {
  const [includeSub, setIncludeSub] = React.useState(false);
  const live = useAuthedQuery(api.categories.detail, orgId ? { orgId, id, includeSubcategories: includeSub || undefined } : "skip") as CategoryDetail | undefined;
  // Keep the last answer while a toggle re-keys the subscription, so the record does not blank.
  const last = React.useRef<CategoryDetail | undefined>(undefined);
  if (live) last.current = live;
  const c = live ?? (last.current?.id === id ? last.current : undefined);
  if (!c) return null; // the page owns loading and not-found
  return <RecordBody c={c} includeSub={includeSub} setIncludeSub={setIncludeSub} orgId={orgId} />;
}
