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
import { useProjectCategories, refreshProjectCategories, refreshUncategorizedItems, refreshProjectOverbooked } from "@/hooks/use-project-equipment";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { addLineItem, checkAvailability, lookupAssetByTag } from "@/server/line-items";
import { useModels } from "@/hooks/use-models";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [mode, setMode] = useState<AddMode>("model");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [assetTagInput, setAssetTagInput] = useState("");
  const [lookupTag, setLookupTag] = useState("");
  const [discountMode, setDiscountMode] = useState<"$" | "%">("$");
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId ?? "");
  const [overbookConfirmed, setOverbookConfirmed] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"combine" | "separate">("combine");
  const [includeAccessories, setIncludeAccessories] = useState(true);

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

  // Reactive models (Convex). Org-scoped list returns all models; re-apply
  // getModels's default active filter and name sort client-side.
  const modelDocs = useModels(orgId);
  const activeModels = useMemo(
    () =>
      [...(modelDocs ?? [])]
        .filter((m) => m.isActive === true)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelDocs],
  );

  // Categories for the optional category picker (only when not pre-set).
  // Passing an undefined key when a category is pre-set preserves the old
  // `enabled: !categoryId` (no fetch).
  const { data: categoriesData } = useProjectCategories(categoryId ? undefined : projectId);

  const categoryOptions = (categoriesData ?? []).map((c: { id: string; name: string }) => ({
    value: c.id,
    label: c.name,
  }));

  const modelOptions = activeModels.map((m) => ({
    value: m.id,
    label: m.name,
    description: [m.manufacturer, m.modelNumber].filter(Boolean).join(" - ") || undefined,
  }));

  const selectedModel = activeModels.find((m) => m.id === selectedModelId);

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
    if (selectedModel) {
      form.setValue("modelId", selectedModel.id);
      form.setValue("assetId", undefined);
    }
  }, [selectedModel, form]);

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
    mutationFn: (data: LineItemFormValues) => {
      let disc = data.discount;
      if (discountMode === "%" && disc && data.unitPrice) {
        const gross = Number(data.unitPrice) * Number(data.quantity ?? 1) * Number(data.duration ?? 1);
        disc = Math.round((gross * Number(disc)) / 100 * 100) / 100;
      }
      const effectiveCategoryId = categoryId || selectedCategoryId || undefined;
      return addLineItem(
        projectId,
        { ...data, discount: disc, categoryId: effectiveCategoryId, groupId },
        overbookConfirmed,
        duplicateAction === "separate",
        includeAccessories
      );
    },
    onSuccess: (result) => {
      const data = result as Record<string, unknown> | null;
      if (data?._merged) {
        toast.success(`Combined with existing — quantity updated to ${data._newQuantity}`);
      } else {
        toast.success("Equipment added");
      }
      refreshProjectDetail(projectId);
      refreshProjectCategories(projectId);
      refreshUncategorizedItems(projectId);
      refreshProjectOverbooked(projectId);
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
  const modelHasAccessories = availability?.hasAccessories === true;
  const assetHasAccessories = assetLookup?.hasAccessories === true;
  const showAccessoriesToggle = mode === "model" ? !!selectedModelId && modelHasAccessories : !!lookupTag && assetHasAccessories;

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
          <Field label="Quantity">
            <Input
              id="eq-quantity"
              type="number"
              min={1}
              {...form.register("quantity")}
              disabled={mode === "asset-tag"}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit price ($)">
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
            <Field label="Discount">
              <div className="flex gap-1.5">
                <Input
                  id="eq-discount"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0"
                  {...form.register("discount")}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setDiscountMode(discountMode === "$" ? "%" : "$")}
                  title={discountMode === "$" ? "Switch to percentage" : "Switch to dollars"}
                  className={cn(
                    "h-11 w-11 shrink-0 rounded-[var(--radius)] border-2 border-input bg-card text-ui-text font-medium text-ink transition-colors hover:bg-paper-2",
                    focusRing,
                  )}
                >
                  {discountMode}
                </button>
              </div>
            </Field>
          </div>
        </section>

        {/* Placement & options */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Placement & options" hint="Where it lands and how it's treated." />

          {targetLabel ? (
            <div className="rounded-[var(--r)] border border-line bg-paper-2/50 px-3 py-2 text-caption text-ink-2">
              Adding to <span className="font-medium text-ink">{targetLabel}</span>
            </div>
          ) : categoryOptions.length > 0 ? (
            <Field label="Category">
              <Select
                value={selectedCategoryId || "__none__"}
                onValueChange={(val) => setSelectedCategoryId(val === "__none__" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {selectedCategoryId
                      ? categoryOptions.find((c: { value: string; label: string }) => c.value === selectedCategoryId)?.label ?? "No category"
                      : "No category"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {categoryOptions.map((c: { value: string; label: string }) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label="Notes">
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

          {showAccessoriesToggle && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                id="eq-includeAccessories"
                checked={includeAccessories}
                onCheckedChange={(c) => setIncludeAccessories(c === true)}
              />
              <span className="text-ui-text text-ink-2">Include accessories</span>
            </label>
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
              (mode === "model" && !canSubmitModel) ||
              (mode === "asset-tag" && !canSubmitAsset)
            }
          >
            Add to project
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ─── Local helpers ───────────────────────────────────────────────

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-card-title font-bold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 t-micro text-muted">{hint}</p>}
    </div>
  );
}

function Field({
  label, required, children,
}: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-red"> *</span>}</Label>
      {children}
    </div>
  );
}

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
