"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Search } from "lucide-react";
import { toast } from "sonner";

import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { addLineItem, checkAvailability, lookupAssetByTag } from "@/server/line-items";
import { getModels } from "@/server/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";

type AddMode = "model" | "asset-tag";

interface AddEquipmentDialogProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-set category for the line item */
  categoryId?: string;
  /** Pre-set group for the line item */
  groupId?: string;
  /** Human-readable label like "Audio > PA System" when adding inside a group */
  targetLabel?: string;
}

export function AddEquipmentDialog({
  projectId,
  rentalStartDate,
  rentalEndDate,
  open,
  onOpenChange,
  categoryId,
  groupId,
  targetLabel,
}: AddEquipmentDialogProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [mode, setMode] = useState<AddMode>("model");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [assetTagInput, setAssetTagInput] = useState("");
  const [lookupTag, setLookupTag] = useState("");

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

  const { data: modelsData } = useQuery({
    queryKey: ["models", orgId, { pageSize: 200 }],
    queryFn: () => getModels({ pageSize: 200 }),
    enabled: open,
  });

  const modelOptions = (modelsData?.models || []).map((m) => ({
    value: m.id,
    label: m.name,
    description: [m.manufacturer, m.modelNumber].filter(Boolean).join(" - ") || undefined,
  }));

  const selectedModel = modelsData?.models?.find(
    (m) => m.id === selectedModelId
  );

  // Model-based availability check (works with or without dates)
  const { data: availability, isLoading: availabilityLoading } = useQuery({
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
  const { data: assetLookup, isLoading: lookupLoading } = useQuery({
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
      form.setValue("description", `${asset.model.name}${asset.customName ? ` (${asset.customName})` : ""} [${asset.assetTag}]`);
    }
  }, [assetLookup, form]);

  const mutation = useMutation({
    mutationFn: (data: LineItemFormValues) =>
      addLineItem(projectId, { ...data, categoryId, groupId }, overbookConfirmed),
    onSuccess: (result) => {
      const data = result as Record<string, unknown> | null;
      if (data?._merged) {
        toast.success(`Merged with existing — quantity updated to ${data._newQuantity}`);
      } else {
        toast.success("Equipment added");
      }
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      queryClient.invalidateQueries({ queryKey: ["project-categories", projectId] });
      queryClient.invalidateQueries({ queryKey: ["uncategorized-items", projectId] });
      onOpenChange(false);
      resetState();
    },
    onError: (e) => toast.error(e.message),
  });

  function resetState() {
    form.reset({
      type: "EQUIPMENT",
      quantity: 1,
      pricingType: "PER_DAY",
      duration: 1,
      isOptional: false,
    });
    setSelectedModelId("");
    setAssetTagInput("");
    setLookupTag("");
    setMode("model");
    setOverbookConfirmed(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) resetState();
  }

  function handleTagSearch() {
    const trimmed = assetTagInput.trim();
    if (trimmed) setLookupTag(trimmed);
  }

  function getAvailabilityColor() {
    if (!availability) return "";
    if (availability.available <= 0)
      return "text-red-600 dark:text-red-400";
    if (availability.available <= Math.ceil((availability.effectiveStock ?? availability.totalStock) * 0.2))
      return "text-amber-600 dark:text-amber-400";
    return "text-green-600 dark:text-green-400";
  }

  const [overbookConfirmed, setOverbookConfirmed] = useState(false);
  const requestedQty = Number(form.watch("quantity")) || 1;
  const isOverbooked = mode === "model" && !!availability && requestedQty > availability.available;

  // Reset overbook confirmation when model or quantity changes
  useEffect(() => {
    setOverbookConfirmed(false);
  }, [selectedModelId, requestedQty]);
  const canSubmitModel = mode === "model" && !!selectedModelId && (!isOverbooked || overbookConfirmed);
  const canSubmitAsset = mode === "asset-tag" && assetLookup?.found && assetLookup.available;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex rounded-md border">
          <button
            type="button"
            onClick={() => { setMode("model"); setLookupTag(""); setAssetTagInput(""); }}
            className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${mode === "model" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            By Model
          </button>
          <button
            type="button"
            onClick={() => { setMode("asset-tag"); setSelectedModelId(""); }}
            className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${mode === "asset-tag" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            By Asset Tag
          </button>
        </div>

        <form
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          className="space-y-4"
        >
          {mode === "model" && (
            <>
              {/* Model picker */}
              <div className="space-y-2">
                <Label>Model</Label>
                <ComboboxPicker
                  value={selectedModelId}
                  onChange={(val) => setSelectedModelId(val)}
                  options={modelOptions}
                  placeholder="Search models..."
                  searchPlaceholder="Search by name, manufacturer..."
                  emptyMessage="No models found."
                  allowClear
                />
              </div>

              {/* Availability */}
              {selectedModelId && (
                <div className="rounded-md border p-3 text-sm">
                  {availabilityLoading ? (
                    <div className="flex items-center gap-2 text-fg-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking availability...
                    </div>
                  ) : availability ? (
                    <div className="space-y-1">
                      <p className={getAvailabilityColor()}>
                        <span className="font-semibold">{availability.available}</span>{" "}
                        available out of{" "}
                        <span className="font-semibold">{availability.effectiveStock ?? availability.totalStock}</span>{" "}
                        {availability.dateless ? "in stock" : "usable"}
                        {availability.bookedOnThisProject > 0 && (
                          <span className="text-fg-3 font-normal">
                            {" "}({availability.bookedOnThisProject} already on this project)
                          </span>
                        )}
                        {availability.dateless && (
                          <span className="text-fg-3 font-normal">
                            {" "}(no dates set — showing stock only)
                          </span>
                        )}
                      </p>
                      {(availability.unavailable ?? 0) > 0 && (
                        <p className="text-purple-600 dark:text-purple-400 text-xs">
                          {availability.unavailable} of {availability.totalStock} total not usable
                          {" "}({[
                            availability.inMaintenance ? `${availability.inMaintenance} in maintenance` : "",
                            availability.lost ? `${availability.lost} lost` : "",
                          ].filter(Boolean).join(", ")})
                        </p>
                      )}
                      {availability.conflicts.length > 0 && (
                        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
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

              {isOverbooked && (() => {
                const isReducedOnly = (availability?.unavailable ?? 0) > 0
                  && requestedQty <= (availability?.totalStock ?? 0) - ((availability?.booked ?? 0) - (availability?.bookedOnThisProject ?? 0));
                const borderColor = isReducedOnly ? "border-purple-500/50 bg-purple-500/10" : "border-red-500/50 bg-red-500/10";
                const textColor = isReducedOnly ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400";
                const accentColor = isReducedOnly ? "accent-purple-500" : "accent-red-500";
                return (
                  <div className={`rounded-md border ${borderColor} p-3 space-y-2`}>
                    <p className={`text-sm font-medium ${textColor}`}>
                      <AlertTriangle className="inline-block mr-1.5 h-3.5 w-3.5" />
                      {isReducedOnly
                        ? `Requesting ${requestedQty} but only ${availability?.available ?? 0} usable — ${availability?.unavailable ?? 0} asset${(availability?.unavailable ?? 0) !== 1 ? "s" : ""} in maintenance or lost`
                        : `This will overbook ${requestedQty} units with only ${availability?.available ?? 0} available`}
                    </p>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overbookConfirmed}
                        onChange={(e) => setOverbookConfirmed(e.target.checked)}
                        className={accentColor}
                      />
                      <span className={textColor}>
                        {isReducedOnly ? "I understand, add anyway" : "I understand, overbook anyway"}
                      </span>
                    </label>
                  </div>
                );
              })()}
            </>
          )}

          {mode === "asset-tag" && (
            <>
              {/* Asset tag search */}
              <div className="space-y-2">
                <Label>Asset Tag</Label>
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
                  <Button type="button" variant="outline" size="icon" onClick={handleTagSearch}>
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Lookup result */}
              {lookupTag && (
                <div className="rounded-md border p-3 text-sm">
                  {lookupLoading ? (
                    <div className="flex items-center gap-2 text-fg-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Looking up asset...
                    </div>
                  ) : assetLookup?.found && assetLookup.asset ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{assetLookup.asset.model.name}</span>
                        <span className="font-mono text-xs text-fg-3">{assetLookup.asset.assetTag}</span>
                      </div>
                      {assetLookup.asset.customName && (
                        <p className="text-xs text-fg-3">{assetLookup.asset.customName}</p>
                      )}
                      {assetLookup.asset.serialNumber && (
                        <p className="text-xs text-fg-3">S/N: {assetLookup.asset.serialNumber}</p>
                      )}
                      {assetLookup.available ? (
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Available
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Not available{assetLookup.conflictsWith ? ` — ${assetLookup.conflictsWith}` : ""}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      No asset found with tag &quot;{lookupTag}&quot;
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="eq-quantity">Quantity</Label>
              <Input
                id="eq-quantity"
                type="number"
                min={1}
                {...form.register("quantity")}
                disabled={mode === "asset-tag"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq-unitPrice">Unit Price ($)</Label>
              <Input
                id="eq-unitPrice"
                type="number"
                step="0.01"
                min={0}
                placeholder="Auto"
                {...form.register("unitPrice")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq-discount">Discount ($)</Label>
              <Input
                id="eq-discount"
                type="number"
                step="0.01"
                min={0}
                placeholder="0.00"
                {...form.register("discount")}
              />
            </div>
          </div>

          {targetLabel && (
            <div className="rounded-md bg-accent/50 px-3 py-2 text-xs text-fg-3">
              Adding to <span className="font-medium text-fg">{targetLabel}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="eq-notes">Notes</Label>
            <Textarea
              id="eq-notes"
              {...form.register("notes")}
              placeholder="Additional notes"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
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
            <Label htmlFor="eq-isOptional" className="text-sm font-normal">
              Optional item (excluded from totals)
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                (mode === "model" && !canSubmitModel) ||
                (mode === "asset-tag" && !canSubmitAsset)
              }
            >
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add to Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
