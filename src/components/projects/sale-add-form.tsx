"use client";

/**
 * Sale add form — the body of the "Sale" kind in UnifiedAddDialog (WS11 #950).
 * Every model is sellable (bulk + serialised); default is a NEW_STOCK sale
 * ("we sell *a* SM58, not *our* SM58" — no rental-asset impact). The explicit
 * "sell from rental stock" mode disposes of an owned unit (serialised -> an
 * asset-tag lookup, same as EquipmentAddForm's "by asset tag" mode) or a bulk
 * quantity (resolved to the model's bulk-asset row via bulkAssets.listByModel).
 *
 * Always forces `pricingType: FLAT, duration: 1` — there is no Days field
 * here at all (unlike CustomItemAddForm, which conditionally hides it): a
 * sale has no rental window to blend into a rate.
 */

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectCategoriesWithGroups } from "@/hooks/use-projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useModelSearch, useModel } from "@/hooks/use-models";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Loader2, CheckCircle2, XCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";

import { lineItemSchema, type LineItemFormValues } from "@/lib/validations/line-item";
import { lookupAssetByTag } from "@/server/line-items";
import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { PlacementFields } from "./placement-fields";
import { SectionTitle, Field } from "./line-item-form-fields";
import type { CategoryData } from "./equipment-rows";

type SaleMode = "NEW_STOCK" | "FROM_RENTAL_STOCK";

export interface SaleAddFormProps {
  projectId: string;
  categoryId?: string;
  groupId?: string;
  targetLabel?: string;
  onInvalidate?: () => void;
  onClose: () => void;
}

export function SaleAddForm({
  projectId,
  categoryId,
  groupId,
  targetLabel,
  onInvalidate,
  onClose,
}: SaleAddFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const lineItemWrites = useLineItemWrites();

  const [saleMode, setSaleMode] = useState<SaleMode>("NEW_STOCK");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [assetTagInput, setAssetTagInput] = useState("");
  const [lookupTag, setLookupTag] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId ?? "");
  const [selectedGroupId, setSelectedGroupId] = useState(groupId ?? "");

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      type: "SALE",
      quantity: 1,
      pricingType: "FLAT",
      duration: 1,
      isOptional: false,
    },
  });

  const [modelQuery, setModelQuery] = useState("");
  const debouncedModelQuery = useDebouncedValue(modelQuery, 200);
  const modelDocs = useModelSearch(orgId, debouncedModelQuery);
  const activeModels = useMemo(
    () => [...(modelDocs ?? [])].filter((m) => m.isActive === true),
    [modelDocs],
  );
  const modelOptions = activeModels.map((m) => ({
    value: m.id,
    label: m.name,
    description: [m.manufacturer, m.modelNumber].filter(Boolean).join(" - ") || undefined,
  }));

  const selectedModel = useModel(selectedModelId || undefined) ?? undefined;
  const selectedModelLabel = selectedModel
    ? `${selectedModel.manufacturer ? `${selectedModel.manufacturer} ` : ""}${selectedModel.name}`
    : undefined;
  const isBulkModel = selectedModel?.assetType === "BULK";

  // The model's bulk-asset row, for FROM_RENTAL_STOCK bulk sales — resolves
  // the row to decrement via adjustBulkTotal (mirrors listByModel's existing
  // shape; a model may have more than one bulk row, first active one wins,
  // same simplification the accessory picker's "first match" pattern uses).
  const bulkAssets = useAuthedQuery(
    api.bulkAssets.listByModel,
    saleMode === "FROM_RENTAL_STOCK" && isBulkModel && orgId && selectedModelId
      ? { modelId: selectedModelId, orgId }
      : "skip",
  );
  const bulkAsset = (bulkAssets ?? []).find((b) => b.isActive !== false);

  const categoriesData = useProjectCategoriesWithGroups(
    categoryId ? undefined : projectId,
    categoryId ? undefined : orgId,
  );
  const placementCategories = (categoriesData ?? []) as unknown as CategoryData[];

  // Asset-tag lookup for FROM_RENTAL_STOCK + serialised — same server helper
  // EquipmentAddForm's "by asset tag" mode uses. Rental dates are irrelevant
  // to a sale (no dates passed) — the sale write path's own findAssetConflict
  // pre-check is what actually warns about a future booking, non-blocking.
  const { data: assetLookup, isLoading: lookupLoading } = useServerQuery({
    queryKey: ["sale-asset-lookup", orgId, lookupTag, projectId],
    queryFn: () => lookupAssetByTag(lookupTag, undefined, undefined, projectId),
    enabled: saleMode === "FROM_RENTAL_STOCK" && !isBulkModel && lookupTag.length > 0,
  });

  useEffect(() => {
    form.setValue("modelId", selectedModelId || undefined);
    form.setValue("assetId", undefined);
    form.setValue("bulkAssetId", undefined);
  }, [selectedModelId, form]);

  useEffect(() => {
    if (saleMode === "FROM_RENTAL_STOCK" && !isBulkModel && assetLookup?.found && assetLookup.asset) {
      const asset = assetLookup.asset;
      form.setValue("assetId", asset.id);
      form.setValue("modelId", asset.modelId);
      form.setValue("quantity", 1);
    }
  }, [assetLookup, saleMode, isBulkModel, form]);

  // Auto-price hint from Model.salePrice (no fallback chain — spec decision;
  // the actual auto-pricing runs server-side in addLineItemSmartNative, this
  // is purely a UI hint so the user sees why the price field is blank/filled).
  const salePriceHint = selectedModel?.salePrice ?? null;

  function handleTagSearch() {
    const trimmed = assetTagInput.trim();
    if (trimmed) setLookupTag(trimmed);
  }

  const mutation = useServerMutation({
    mutationFn: async (data: LineItemFormValues) => {
      const effectiveCategoryId = categoryId || selectedCategoryId || undefined;
      const effectiveGroupId = groupId || selectedGroupId || undefined;
      const parsed = lineItemSchema.parse({
        ...data,
        type: "SALE",
        saleMode,
        pricingType: "FLAT",
        duration: 1,
        bulkAssetId: saleMode === "FROM_RENTAL_STOCK" && isBulkModel ? bulkAsset?.id : undefined,
        categoryId: effectiveCategoryId,
        groupId: effectiveGroupId,
      });
      return lineItemWrites.add(projectId, parsed, {
        allowOverbook: true, // SALE never runs the availability/double-booking gate
        forceSeparate: true, // SALE never merges (type-gated server-side too)
        includeAccessories: false, // SALE lines never expand accessories
      });
    },
    onSuccess: (result) => {
      if (result?.saleWarning) toast.warning(result.saleWarning);
      toast.success("Sale added");
      refreshProjectDetail(projectId);
      onInvalidate?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmitNewStock = saleMode === "NEW_STOCK" && !!selectedModelId;
  const canSubmitFromRentalBulk = saleMode === "FROM_RENTAL_STOCK" && isBulkModel && !!bulkAsset;
  const canSubmitFromRentalSerial =
    saleMode === "FROM_RENTAL_STOCK" && !isBulkModel && !!assetLookup?.found && !!assetLookup.asset;
  const canSubmit =
    canSubmitNewStock || canSubmitFromRentalBulk || canSubmitFromRentalSerial;

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
      <section className="space-y-4">
        <SectionTitle title="Sale source" hint="New stock has no rental-asset impact; selling from rental stock disposes of an owned unit." />
        <div role="radiogroup" aria-label="Sale source" className="flex gap-1 rounded-[var(--r)] border border-line bg-paper-2/50 p-1">
          <SaleModeTab active={saleMode === "NEW_STOCK"} onClick={() => setSaleMode("NEW_STOCK")}>
            New stock
          </SaleModeTab>
          <SaleModeTab active={saleMode === "FROM_RENTAL_STOCK"} onClick={() => setSaleMode("FROM_RENTAL_STOCK")}>
            From rental stock
          </SaleModeTab>
        </div>

        <Field label="Model" required>
          <ComboboxPicker
            value={selectedModelId}
            onChange={(val) => setSelectedModelId(val)}
            options={modelOptions}
            onSearchChange={setModelQuery}
            loading={modelDocs === undefined}
            selectedLabel={selectedModelLabel}
            placeholder="Search models…"
            searchPlaceholder="Search by name, manufacturer…"
            emptyMessage="No models found."
            allowClear
          />
        </Field>

        {saleMode === "FROM_RENTAL_STOCK" && selectedModelId && !isBulkModel && (
          <SerializedAssetLookup
            assetTagInput={assetTagInput}
            onAssetTagInputChange={setAssetTagInput}
            onSearch={handleTagSearch}
            lookupTag={lookupTag}
            lookupLoading={lookupLoading}
            assetLookup={assetLookup}
          />
        )}

        {saleMode === "FROM_RENTAL_STOCK" && selectedModelId && isBulkModel && (
          <BulkStockPreview bulkAssets={bulkAssets} bulkAsset={bulkAsset} />
        )}
      </section>

      <section className="space-y-4 border-t border-line pt-5">
        <SectionTitle
          title="Pricing"
          hint={salePriceHint != null ? `Auto-prices at $${salePriceHint.toFixed(2)} from the model's sale price.` : "No sale price set on this model — enter one manually."}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" htmlFor="sale-qty">
            <Input id="sale-qty" type="number" min={1} {...form.register("quantity")} disabled={saleMode === "FROM_RENTAL_STOCK" && !isBulkModel} />
          </Field>
          <Field label="Unit price ($)" htmlFor="sale-unitPrice">
            <Input
              id="sale-unitPrice"
              type="number"
              step="0.01"
              min={0}
              placeholder={salePriceHint != null ? salePriceHint.toFixed(2) : "0.00"}
              {...form.register("unitPrice")}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-line pt-5">
        <SectionTitle title="Placement & options" hint="Where it lands and how it's treated. Sale lines ride in their category/group like any other item — a SALE badge differentiates them on documents." />

        {targetLabel ? (
          <div className="rounded-[var(--r)] border border-line bg-paper-2/50 px-3 py-2 text-caption text-ink-2">
            Adding to <span className="font-medium text-ink">{targetLabel}</span>
          </div>
        ) : placementCategories.length > 0 ? (
          <PlacementFields
            categories={placementCategories}
            categoryId={selectedCategoryId}
            groupId={selectedGroupId}
            onChange={({ categoryId, groupId }) => {
              setSelectedCategoryId(categoryId);
              setSelectedGroupId(groupId);
            }}
          />
        ) : null}

        <Field label="Notes" htmlFor="sale-notes">
          <Textarea id="sale-notes" {...form.register("notes")} placeholder="Additional notes" rows={2} />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5">
          <Controller
            control={form.control}
            name="isOptional"
            render={({ field }) => (
              <Checkbox id="sale-isOptional" checked={field.value ?? false} onCheckedChange={field.onChange} />
            )}
          />
          <span className="text-ui-text text-ink-2">Optional item (excluded from totals)</span>
        </label>
      </section>

      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!lineItemWrites.enabled || !canSubmit}>
          Add sale
        </Button>
      </DialogFooter>
    </form>
  );
}

function SaleModeTab({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-[10px] px-3 py-1.5 text-ui-text font-medium transition-colors",
        focusRing,
        active ? "bg-red text-primary-foreground shadow-[var(--sh-stk)]" : "text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ─── FROM_RENTAL_STOCK lookup sub-components ────────────────────────────────
// Extracted out of the main component (not just for reuse) to keep
// SaleAddForm's own cyclomatic complexity down — each owns its own small
// conditional-rendering budget instead of adding to the parent's (R-3.6).

interface SerializedAssetLookupProps {
  assetTagInput: string;
  onAssetTagInputChange: (v: string) => void;
  onSearch: () => void;
  lookupTag: string;
  lookupLoading: boolean;
  assetLookup: Awaited<ReturnType<typeof lookupAssetByTag>> | undefined;
}

function SerializedAssetLookup({
  assetTagInput, onAssetTagInputChange, onSearch, lookupTag, lookupLoading, assetLookup,
}: SerializedAssetLookupProps) {
  return (
    <Field label="Asset tag" required>
      <div className="flex gap-2">
        <Input
          value={assetTagInput}
          onChange={(e) => onAssetTagInputChange(e.target.value)}
          placeholder="e.g. AV-AUD-001"
          className="font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch();
            }
          }}
        />
        <Button type="button" variant="line" size="icon" className="shrink-0" onClick={onSearch} title="Look up asset">
          <Search className="h-4 w-4" />
        </Button>
      </div>
      {lookupTag && (
        <div className="mt-2 rounded-[var(--r)] border border-line bg-paper-2/50 p-3 text-caption">
          <SerializedAssetLookupResult lookupLoading={lookupLoading} assetLookup={assetLookup} lookupTag={lookupTag} />
        </div>
      )}
    </Field>
  );
}

function SerializedAssetLookupResult({
  lookupLoading, assetLookup, lookupTag,
}: Pick<SerializedAssetLookupProps, "lookupLoading" | "assetLookup" | "lookupTag">) {
  if (lookupLoading) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Looking up asset…
      </div>
    );
  }
  if (assetLookup?.found && assetLookup.asset) {
    return (
      <div className="flex items-center gap-2 text-ok">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-ink">{assetLookup.asset.model?.name ?? "—"}</span>
        <span className="t-mono text-muted">{assetLookup.asset.assetTag}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-t-out">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      No asset found with tag &quot;{lookupTag}&quot;
    </div>
  );
}

/** Minimal shape this preview needs off a bulkAssets.listByModel row. */
interface BulkStockPreviewAsset {
  id: string;
  assetTag: string;
  availableQuantity?: number | null;
  totalQuantity?: number | null;
}

function BulkStockPreview({
  bulkAssets, bulkAsset,
}: {
  bulkAssets: BulkStockPreviewAsset[] | undefined;
  bulkAsset: BulkStockPreviewAsset | undefined;
}) {
  return (
    <div className="rounded-[var(--r)] border border-line bg-paper-2/50 p-3 text-caption">
      {bulkAssets === undefined ? (
        <div className="flex items-center gap-2 text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking bulk stock…
        </div>
      ) : bulkAsset ? (
        <p className="text-ink-2">
          Selling from <span className="font-medium text-ink">{bulkAsset.assetTag}</span> — {bulkAsset.availableQuantity ?? 0} available of {bulkAsset.totalQuantity ?? 0} total.
        </p>
      ) : (
        <p className="text-t-out">No bulk stock row found for this model.</p>
      )}
    </div>
  );
}
