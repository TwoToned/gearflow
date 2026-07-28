"use client";

/**
 * Equipment add form — the body of the "Add Equipment" flow. Mounted by
 * UnifiedAddDialog (Phase 4d) when the user picks the "Own stock" tab.
 *
 * Renders the mode toggle (By model / By asset tag), the form fields,
 * and the footer (Add to project). No Dialog wrapper — the caller
 * supplies that.
 */

import { useEffect, useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectCategoriesWithGroups } from "@/hooks/use-projects";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { checkAvailability, lookupAssetByTag } from "@/server/line-items";
import { useLineItemWrites, type AccessoryPlanInput } from "@/hooks/use-line-item-writes";
import { useModelSearch, useModel } from "@/hooks/use-models";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { PlacementFields } from "./placement-fields";
import { SectionTitle, Field, DiscountField, resolveDiscountAmount, type DiscountMode } from "./line-item-form-fields";
import type { CategoryData } from "./equipment-rows";
import { useActiveOrganization } from "@/lib/auth-client";

type AddMode = "model" | "asset-tag";

export interface EquipmentAddFormProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  /** Pre-set category for the line item. */
  categoryId?: string;
  /** Pre-set group for the line item. */
  groupId?: string;
  /** Human-readable label like "Audio > PA System" when adding inside a group. */
  targetLabel?: string;
  /** Invalidate queries after a successful add. The form invalidates its own
   *  internal queries as well; this callback is for parent-owned invalidations. */
  onInvalidate?: () => void;
  /** Close the surrounding dialog. */
  onClose: () => void;
  /** Open the sub-hire order dialog instead of overbooking. */
  onOpenSubHire?: () => void;
}

export function EquipmentAddForm({
  projectId,
  rentalStartDate,
  rentalEndDate,
  categoryId,
  groupId,
  targetLabel,
  onInvalidate,
  onClose,
  onOpenSubHire,
}: EquipmentAddFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const lineItemWrites = useLineItemWrites();
  const [mode, setMode] = useState<AddMode>("model");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [assetTagInput, setAssetTagInput] = useState("");
  const [lookupTag, setLookupTag] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("$");
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId ?? "");
  const [selectedGroupId, setSelectedGroupId] = useState(groupId ?? "");
  const [overbookConfirmed, setOverbookConfirmed] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"combine" | "separate">("combine");
  // Per-accessory selection (issue #794), keyed by the modelBulkAccessories row id —
  // replaces the old all-or-nothing "Include accessories" checkbox. DEFAULT rows
  // start selected (deselecting records an exclusion); OPTIONAL rows start
  // unselected (selecting opts in). See accessoryPlan below for the derived plan.
  const [accessorySelection, setAccessorySelection] = useState<Record<string, boolean>>({});
  // A DEFAULT accessory auto-includes, so deselecting one is a deliberate
  // override — gated behind a required typed reason (issue #794 follow-up),
  // unlike OPTIONAL rows which stay a plain, frictionless checkbox.
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  const [pendingExclude, setPendingExclude] = useState<{ id: string; label: string } | null>(null);
  const [excludeReasonDraft, setExcludeReasonDraft] = useState("");

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      type: "EQUIPMENT",
      quantity: 1,
      pricingType: "PER_DAY",
      duration: 1,
      isOptional: false,
    },
  });

  // Phase 7 — native INDEXED model search (name OR manufacturer, bounded + reactive)
  // instead of loading the whole org catalog to JS-filter. Debounced as the user types;
  // re-apply getModels' active filter on the bounded result set.
  const [modelQuery, setModelQuery] = useState("");
  const debouncedModelQuery = useDebouncedValue(modelQuery, 200);
  const modelDocs = useModelSearch(orgId, debouncedModelQuery);
  const activeModels = useMemo(
    () => [...(modelDocs ?? [])].filter((m) => m.isActive === true),
    [modelDocs],
  );

  // Categories for the optional category picker (only when not pre-set).
  // Passing an undefined key when a category is pre-set preserves the old
  // `enabled: !categoryId` (no fetch).
  const categoriesData = useProjectCategoriesWithGroups(
    categoryId ? undefined : projectId,
    categoryId ? undefined : orgId,
  );

  // CategoryData[] (id, name, groups) for the shared PlacementFields picker —
  // native categories + their project groups composed reactively.
  const placementCategories = (categoriesData ?? []) as unknown as CategoryData[];

  const modelOptions = activeModels.map((m) => ({
    value: m.id,
    label: m.name,
    description: [m.manufacturer, m.modelNumber].filter(Boolean).join(" - ") || undefined,
  }));

  // Resolve the selected model directly (it may not be in the current search page) so
  // the trigger label + the modelId effect below don't depend on the search results.
  const selectedModel = useModel(selectedModelId || undefined) ?? undefined;
  const selectedModelLabel = selectedModel
    ? `${selectedModel.manufacturer ? `${selectedModel.manufacturer} ` : ""}${selectedModel.name}`
    : undefined;

  // Model-based availability check (works with or without dates)
  const { data: availability, isLoading: availabilityLoading } = useServerQuery({
    queryKey: [
      "availability",
      orgId,
      selectedModelId,
      rentalStartDate?.toISOString(),
      rentalEndDate?.toISOString(),
      projectId,
    ],
    queryFn: () =>
      checkAvailability(
        selectedModelId,
        rentalStartDate ?? null,
        rentalEndDate ?? null,
        projectId
      ),
    enabled: mode === "model" && !!selectedModelId,
  });

  // Asset tag lookup
  const { data: assetLookup, isLoading: lookupLoading } = useServerQuery({
    queryKey: [
      "asset-lookup",
      orgId,
      lookupTag,
      rentalStartDate?.toISOString(),
      rentalEndDate?.toISOString(),
      projectId,
    ],
    queryFn: () =>
      lookupAssetByTag(lookupTag, rentalStartDate, rentalEndDate, projectId),
    enabled: mode === "asset-tag" && lookupTag.length > 0,
  });

  // When a model is selected, update form fields
  // Don't set unitPrice here — server-side optimizer will auto-price if billing period + rates exist
  useEffect(() => {
    if (selectedModelId) {
      form.setValue("modelId", selectedModelId);
      form.setValue("assetId", undefined);
    }
  }, [selectedModelId, form]);

  // When asset is looked up, populate form
  useEffect(() => {
    if (assetLookup?.found && assetLookup.asset) {
      const asset = assetLookup.asset;
      form.setValue("modelId", asset.modelId);
      form.setValue("assetId", asset.id);
      form.setValue("quantity", 1);
      form.setValue(
        "description",
        `${asset.model?.name ?? "—"}${asset.customName ? ` (${asset.customName})` : ""} [${asset.assetTag}]`
      );
    }
  }, [assetLookup, form]);

  const mutation = useServerMutation({
    mutationFn: async (data: LineItemFormValues) => {
      // #1012: one shared conversion (resolveDiscountAmount) instead of a
      // hand-rolled copy, and the MODE is submitted alongside the resolved
      // dollar amount so documents can print it back as entered.
      const gross = Number(data.unitPrice ?? 0) * Number(data.quantity ?? 1) * Number(data.duration ?? 1);
      const disc = resolveDiscountAmount(discountMode, data.discount as number | string | undefined, gross);
      const effectiveCategoryId = categoryId || selectedCategoryId || undefined;
      const effectiveGroupId = groupId || selectedGroupId || undefined;
      // Browser-direct native path. addLineItemSmartNative folds availability +
      // merge-dedup + auto-pricing + accessory expansion + recalc + audit + collab into one
      // transaction. The list is a reactive useQuery, so the new/merged row appears on its
      // own; the return is used only for the merged-toast.
      const parsed = lineItemSchema.parse({
        ...data,
        discount: disc,
        discountMode,
        categoryId: effectiveCategoryId,
        groupId: effectiveGroupId,
      });
      const res = await lineItemWrites.add(projectId, parsed, {
        allowOverbook: overbookConfirmed,
        forceSeparate: duplicateAction === "separate",
        // Per-accessory selection now replaces the all-or-nothing toggle (issue
        // #794) — "exclude all" is just a plan excluding every default.
        includeAccessories: true,
        accessoryPlan,
      });
      // Native returns { id, merged }; reshape to the _merged/_newQuantity onSuccess
      // expects. Merged qty mirrors the "combine" radio's preview.
      return res.merged
        ? {
            _merged: true,
            _newQuantity: availability
              ? availability.bookedOnThisProject + (Number(data.quantity) || 1)
              : undefined,
          }
        : { _merged: false };
    },
    onSuccess: (result) => {
      const data = result as Record<string, unknown> | null;
      if (data?._merged) {
        // The native merge targets the matching category/group line; the client can't
        // know the exact resulting quantity (a model may span several lines), so don't
        // assert a number the reactive list will show accurately anyway.
        toast.success("Combined with an existing line");
      } else {
        toast.success("Equipment added");
      }
      refreshProjectDetail(projectId);
      onInvalidate?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleTagSearch() {
    const trimmed = assetTagInput.trim();
    if (trimmed) setLookupTag(trimmed);
  }

  // Availability headline colour, mapped to RVLT semantic tokens:
  // none available → problem (t-out); near-limit → warning; otherwise → ok.
  function getAvailabilityColor() {
    if (!availability) return "";
    if (availability.available <= 0) return "text-t-out";
    if (
      availability.available <=
      Math.ceil((availability.effectiveStock ?? availability.totalStock) * 0.2)
    )
      return "text-warn";
    return "text-ok";
  }

  const requestedQty = Number(form.watch("quantity")) || 1;
  const isOverbooked = mode === "model" && !!availability && requestedQty > availability.available;
  const hasDuplicate = mode === "model" && !!availability && availability.bookedOnThisProject > 0;
  // Accessories picker (issue #794) — model add and by-asset-tag add share the same
  // model-level DEFAULT/OPTIONAL list (asset-level serialised/bulk children still
  // always auto-attach, unaffected by this picker — see FEATUREDOCS/48).
  const accessories = mode === "model" ? (availability?.accessories ?? []) : (assetLookup?.accessories ?? []);
  const accessoryKey = accessories.map((a) => a.id).join(",");
  useEffect(() => {
    setAccessorySelection((prev) => {
      const next: Record<string, boolean> = {};
      for (const a of accessories) {
        next[a.id] = a.id in prev ? prev[a.id] : a.inclusion !== "OPTIONAL";
      }
      return next;
    });
    // Only reinitialize when the SET of accessory rows changes, not on every
    // availability refetch — re-running per object identity would clobber toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessoryKey]);

  const defaultAccessories = accessories.filter((a) => a.inclusion !== "OPTIONAL");
  const optionalAccessories = accessories.filter((a) => a.inclusion === "OPTIONAL");

  const accessoryPlan: AccessoryPlanInput | undefined = useMemo(() => {
    if (accessories.length === 0) return undefined;
    const excludedRows = defaultAccessories.filter((a) => accessorySelection[a.id] === false);
    const added = optionalAccessories
      .filter((a) => accessorySelection[a.id] === true)
      .map((a) => ({ bulkAssetId: a.bulkAssetId }));
    if (excludedRows.length === 0 && added.length === 0) return undefined;
    return {
      excluded: excludedRows.map((a) => a.bulkAssetId),
      added,
      excludedReasons: excludedRows.map((a) => ({ bulkAssetId: a.bulkAssetId, reason: excludeReasons[a.id] ?? "" })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessorySelection, accessoryKey, excludeReasons]);

  // Reset overbook confirmation when model or quantity changes
  useEffect(() => {
    setOverbookConfirmed(false);
  }, [selectedModelId, requestedQty]);

  // Reset duplicate action only when model changes (not quantity)
  useEffect(() => {
    setDuplicateAction("combine");
  }, [selectedModelId]);

  const canSubmitModel = mode === "model" && !!selectedModelId && (!isOverbooked || overbookConfirmed);
  const canSubmitAsset = mode === "asset-tag" && assetLookup?.found && assetLookup.available;

  return (
    <>
      {/* Mode toggle */}
      <div role="tablist" aria-label="Add by" className="flex gap-1 rounded-[var(--r)] border border-line bg-paper-2/50 p-1">
        <ModeTab
          active={mode === "model"}
          onClick={() => {
            setMode("model");
            setLookupTag("");
            setAssetTagInput("");
          }}
        >
          By model
        </ModeTab>
        <ModeTab
          active={mode === "asset-tag"}
          onClick={() => {
            setMode("asset-tag");
            setSelectedModelId("");
          }}
        >
          By asset tag
        </ModeTab>
      </div>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
        {/* Selection */}
        <section className="space-y-4">
          <SectionTitle
            title="Selection"
            hint={mode === "model" ? "Pick a model — availability checks as you go." : "Scan or type an asset tag to look it up."}
          />

          {mode === "model" && (
            <>
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

              {/* Availability */}
              {selectedModelId && (
                <div className="rounded-[var(--r)] border border-line bg-paper-2/50 p-3 text-caption">
                  {availabilityLoading ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking availability…
                    </div>
                  ) : availability ? (
                    <div className="space-y-1">
                      <p className={getAvailabilityColor()}>
                        <span className="t-data font-semibold">{availability.available}</span>{" "}
                        available out of{" "}
                        <span className="t-data font-semibold">
                          {availability.effectiveStock ?? availability.totalStock}
                        </span>{" "}
                        {availability.dateless ? "in stock" : "usable"}
                        {availability.bookedOnThisProject > 0 && (
                          <span className="font-normal text-muted">
                            {" "}
                            ({availability.bookedOnThisProject} already on this project)
                          </span>
                        )}
                        {availability.dateless && (
                          <span className="font-normal text-muted">
                            {" "}
                            (no dates set — showing stock only)
                          </span>
                        )}
                      </p>
                      {(availability.unavailable ?? 0) > 0 && (
                        <p className="text-blue t-micro">
                          {availability.unavailable} of {availability.totalStock} total not usable
                          {" "}
                          ({[
                            availability.inMaintenance ? `${availability.inMaintenance} in maintenance` : "",
                            availability.lost ? `${availability.lost} lost` : "",
                          ]
                            .filter(Boolean)
                            .join(", ")})
                        </p>
                      )}
                      {availability.conflicts.length > 0 && (
                        <div className="flex items-start gap-2 text-warn">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div>
                            <p className="font-medium">Conflicts:</p>
                            <ul className="list-disc pl-4">
                              {availability.conflicts.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {hasDuplicate && (
                <div className="space-y-2 rounded-[var(--r)] border-l-[3px] border-warn bg-warn-soft px-3 py-2.5">
                  <p className="text-caption font-medium text-warn">
                    {availability!.bookedOnThisProject} already on this project
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <RadioRow
                      name="duplicate-action"
                      checked={duplicateAction === "combine"}
                      onChange={() => setDuplicateAction("combine")}
                    >
                      Combine with existing (qty → {availability!.bookedOnThisProject + requestedQty})
                    </RadioRow>
                    <RadioRow
                      name="duplicate-action"
                      checked={duplicateAction === "separate"}
                      onChange={() => setDuplicateAction("separate")}
                    >
                      Add as separate line item
                    </RadioRow>
                  </div>
                </div>
              )}

              {isOverbooked && (() => {
                const isReducedOnly =
                  (availability?.unavailable ?? 0) > 0 &&
                  requestedQty <=
                    (availability?.totalStock ?? 0) -
                      ((availability?.booked ?? 0) - (availability?.bookedOnThisProject ?? 0));
                // Reduced-availability (maintenance/lost) reads as info (blue);
                // a true overbook reads as a problem (t-out / out-soft).
                const accentClass = isReducedOnly
                  ? "border-blue bg-blue-soft"
                  : "border-t-out bg-out-soft";
                const textColor = isReducedOnly ? "text-blue" : "text-t-out";
                return (
                  <div className={cn("space-y-2 rounded-[var(--r)] border-l-[3px] px-3 py-2.5", accentClass)}>
                    <p className={cn("flex items-start gap-1.5 text-caption font-medium", textColor)}>
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {isReducedOnly
                          ? `Requesting ${requestedQty} but only ${availability?.available ?? 0} usable — ${availability?.unavailable ?? 0} asset${(availability?.unavailable ?? 0) !== 1 ? "s" : ""} in maintenance or lost`
                          : `This will overbook ${requestedQty} units with only ${availability?.available ?? 0} available`}
                      </span>
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 text-caption">
                      <Checkbox
                        checked={overbookConfirmed}
                        onCheckedChange={(c) => setOverbookConfirmed(c === true)}
                      />
                      <span className={textColor}>
                        {isReducedOnly ? "I understand, add anyway" : "I understand, overbook anyway"}
                      </span>
                    </label>
                    {!isReducedOnly && selectedModelId && onOpenSubHire && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSubHire();
                        }}
                        className={cn(
                          "block rounded-[6px] text-caption font-medium text-link hover:underline",
                          focusRing,
                        )}
                      >
                        Sub-hire {requestedQty - (availability?.available ?? 0)} units instead
                      </button>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {mode === "asset-tag" && (
            <>
              <Field label="Asset tag" required>
                <div className="flex gap-2">
                  <Input
                    value={assetTagInput}
                    onChange={(e) => setAssetTagInput(e.target.value)}
                    placeholder="e.g. AV-AUD-001"
                    className="font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleTagSearch();
                      }
                    }}
                  />
                  <Button type="button" variant="line" size="icon" className="shrink-0" onClick={handleTagSearch} title="Look up asset">
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </Field>

              {/* Lookup result */}
              {lookupTag && (
                <div className="rounded-[var(--r)] border border-line bg-paper-2/50 p-3 text-caption">
                  {lookupLoading ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Looking up asset…
                    </div>
                  ) : assetLookup?.found && assetLookup.asset ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{assetLookup.asset.model?.name ?? "—"}</span>
                        <span className="t-mono text-muted">{assetLookup.asset.assetTag}</span>
                      </div>
                      {assetLookup.asset.customName && (
                        <p className="t-micro text-muted">{assetLookup.asset.customName}</p>
                      )}
                      {assetLookup.asset.serialNumber && (
                        <p className="t-micro text-muted">S/N: {assetLookup.asset.serialNumber}</p>
                      )}
                      {assetLookup.available ? (
                        <div className="flex items-center gap-1.5 text-ok">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Available
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-t-out">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>
                            Not available
                            {assetLookup.conflictsWith ? ` — ${assetLookup.conflictsWith}` : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-t-out">
                      <XCircle className="h-3.5 w-3.5" />
                      No asset found with tag &quot;{lookupTag}&quot;
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Pricing */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Pricing" hint="Quantity and rate. Leave the price blank to auto-price." />
          <Field label="Quantity" htmlFor="eq-quantity">
            <Input
              id="eq-quantity"
              type="number"
              min={1}
              {...form.register("quantity")}
              disabled={mode === "asset-tag"}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit price ($)" htmlFor="eq-unitPrice">
              <Input
                id="eq-unitPrice"
                type="number"
                step="0.01"
                min={0}
                placeholder="Auto"
                {...form.register("unitPrice")}
              />
              {Number(form.watch("unitPrice")) > 0 && (
                <p className="t-micro text-warn">Overrides auto-pricing</p>
              )}
            </Field>
            <Controller
              control={form.control}
              name="discount"
              render={({ field }) => (
                <DiscountField
                  id="eq-discount"
                  value={field.value == null ? "" : String(field.value)}
                  onValueChange={field.onChange}
                  mode={discountMode}
                  onModeChange={setDiscountMode}
                />
              )}
            />
          </div>
        </section>

        {/* Placement & options */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Placement & options" hint="Where it lands and how it's treated." />

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

          <Field label="Notes" htmlFor="eq-notes">
            <Textarea id="eq-notes" {...form.register("notes")} placeholder="Additional notes" rows={2} />
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5">
            <Controller
              control={form.control}
              name="isOptional"
              render={({ field }) => (
                <Checkbox
                  id="eq-isOptional"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <span className="text-ui-text text-ink-2">Optional item (excluded from totals)</span>
          </label>

          {accessories.length > 0 && (
            <div className="space-y-2.5 rounded-[var(--r)] border border-line bg-paper-2/50 p-3">
              <p className="t-overline text-muted">Accessories</p>

              {defaultAccessories.length > 0 && (
                <div className="space-y-1.5">
                  <p className="t-micro text-faint">Included</p>
                  {defaultAccessories.map((a) => {
                    const checked = accessorySelection[a.id] ?? true;
                    const label = a.modelName ?? a.assetTag;
                    return (
                      <div key={a.id} className="space-y-1">
                        <label className="flex cursor-pointer items-center gap-2.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              if (c === true) {
                                setAccessorySelection((prev) => ({ ...prev, [a.id]: true }));
                                setExcludeReasons((prev) => {
                                  const next = { ...prev };
                                  delete next[a.id];
                                  return next;
                                });
                              } else {
                                setExcludeReasonDraft("");
                                setPendingExclude({ id: a.id, label });
                              }
                            }}
                          />
                          <span className="text-ui-text text-ink-2">
                            <span className="t-data tabular-nums">{a.quantity * requestedQty}×</span>{" "}
                            {label}
                          </span>
                        </label>
                        {!checked && excludeReasons[a.id] && (
                          <p className="pl-6 t-micro text-muted">Removed: {excludeReasons[a.id]}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {optionalAccessories.length > 0 && (
                <div className="space-y-1.5">
                  <p className="t-micro text-faint">Optional</p>
                  {optionalAccessories.map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2.5">
                      <Checkbox
                        checked={accessorySelection[a.id] ?? false}
                        onCheckedChange={(c) =>
                          setAccessorySelection((prev) => ({ ...prev, [a.id]: c === true }))
                        }
                      />
                      <span className="text-ui-text text-ink-2">
                        <span className="t-data tabular-nums">{a.quantity * requestedQty}×</span>{" "}
                        {a.modelName ?? a.assetTag}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={
              !lineItemWrites.enabled ||
              (mode === "model" && !canSubmitModel) ||
              (mode === "asset-tag" && !canSubmitAsset)
            }
          >
            Add to project
          </Button>
        </DialogFooter>
      </form>

      {/* Removing a DEFAULT accessory is a deliberate override — require a
          reason before it actually excludes (issue #794 follow-up). Optional
          accessories stay a plain, frictionless checkbox. */}
      <Dialog open={!!pendingExclude} onOpenChange={(o) => !o && setPendingExclude(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove default accessory?</DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted">
            <span className="font-medium text-ink">{pendingExclude?.label}</span> ships with every asset
            of this model by default. Removing it from just this line needs a reason.
          </p>
          <div className="space-y-2 py-2">
            <Label htmlFor="exclude-reason">Reason</Label>
            <Textarea
              id="exclude-reason"
              value={excludeReasonDraft}
              onChange={(e) => setExcludeReasonDraft(e.target.value)}
              placeholder="e.g. customer is supplying their own"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setPendingExclude(null)}>
              Cancel
            </Button>
            <Button
              disabled={!excludeReasonDraft.trim()}
              onClick={() => {
                if (!pendingExclude) return;
                setAccessorySelection((prev) => ({ ...prev, [pendingExclude.id]: false }));
                setExcludeReasons((prev) => ({ ...prev, [pendingExclude.id]: excludeReasonDraft.trim() }));
                setPendingExclude(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Local helpers ───────────────────────────────────────────────

function ModeTab({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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

function RadioRow({
  name, checked, onChange, children,
}: {
  name: string; checked: boolean; onChange: () => void; children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-2">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className={cn("size-4 accent-red", focusRing)}
      />
      <span>{children}</span>
    </label>
  );
}
