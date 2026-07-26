"use client";

/**
 * Custom-item add form — the body of the "Add Custom Item" flow, extracted
 * from equipment-tab.tsx so it can be embedded both in its own dialog and in
 * the unified add dialog (Phase 4 of cross-type unification).
 *
 * Renders the fields + footer (Cancel / Add Item) and owns the
 * addCustomLineItem mutation. No Dialog wrapper — the caller supplies that.
 *
 * RHF + zodResolver(customLineItemSchema) (#883) — was hand-rolled useState
 * per field with only a submit-time `.parse()`, so bounds like `unitPrice ≤
 * 999999.99` never surfaced as inline field errors. The discount field now
 * shares the $/% toggle used by equipment-add-form instead of being dollars-only.
 */

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { toast } from "sonner";

import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import { customLineItemSchema, type CustomLineItemFormValues } from "@/lib/validations/line-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { PlacementFields } from "./placement-fields";
import { SectionTitle, Field, DiscountField, type DiscountMode } from "./line-item-form-fields";
import type { CategoryData } from "./equipment-rows";

type CustomItemPricingType = "PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR";

const PRICING_LABELS: Record<CustomItemPricingType, string> = {
  FLAT: "Flat",
  PER_DAY: "Per day",
  PER_WEEK: "Per week",
  PER_HOUR: "Per hour",
};
const PRICING_ORDER: CustomItemPricingType[] = ["FLAT", "PER_DAY", "PER_WEEK", "PER_HOUR"];

interface CustomItemAddFormProps {
  projectId: string;
  categories: CategoryData[];
  /** Pre-selected category (e.g. when launched from a category/group context). */
  defaultCategoryId?: string;
  /** Pre-selected group. */
  defaultGroupId?: string;
  /** Invalidate queries after a successful add. */
  onInvalidate: () => void;
  /** Close the surrounding dialog. */
  onClose: () => void;
}

export function CustomItemAddForm({
  projectId,
  categories,
  defaultCategoryId,
  defaultGroupId,
  onInvalidate,
  onClose,
}: CustomItemAddFormProps) {
  const lineItemWrites = useLineItemWrites();
  const [discountMode, setDiscountMode] = useState<DiscountMode>("$");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [groupId, setGroupId] = useState(defaultGroupId ?? "");

  const form = useForm<CustomLineItemFormValues>({
    resolver: zodResolver(customLineItemSchema),
    defaultValues: {
      quantity: 1,
      pricingType: "FLAT",
      duration: 1,
      isOptional: false,
    },
  });

  // Resolve a groupId → its title, from the categories the form already holds — the
  // browser-direct twin of the server's Convex getById lookup (no round-trip needed).
  const resolveGroupName = (gid: string | undefined): string | undefined => {
    if (!gid) return undefined;
    for (const c of categories) {
      const g = c.groups.find((grp) => grp.id === gid);
      if (g) return g.title ?? undefined;
    }
    return undefined;
  };

  const addMut = useServerMutation({
    mutationFn: (data: CustomLineItemFormValues) => {
      let disc = data.discount;
      if (discountMode === "%" && disc && data.unitPrice) {
        const gross = Number(data.unitPrice) * Number(data.quantity ?? 1) * Number(data.duration ?? 1);
        disc = Math.round((gross * Number(disc)) / 100 * 100) / 100;
      }
      // Browser-direct native path. addCustomNative folds recalc + audit + collab into one
      // transaction; reactive useQuery renders the new row. groupName is resolved locally
      // from the categories the form already holds (no round-trip).
      const parsed = customLineItemSchema.parse({
        ...data,
        discount: disc,
        categoryId: categoryId || undefined,
        groupId: groupId || undefined,
      });
      return lineItemWrites.addCustom(projectId, parsed, {
        groupName: resolveGroupName(parsed.groupId),
      });
    },
    onSuccess: () => {
      onInvalidate();
      refreshProjectDetail(projectId);
      toast.success("Custom item added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pricingType = form.watch("pricingType") ?? "FLAT";

  // ─── Live summary ──────────────────────────────────────────────
  const name = form.watch("description") ?? "";
  const qtyNum = Math.max(1, Number(form.watch("quantity")) || 1);
  const priceNum = Number(form.watch("unitPrice")) || 0;
  const durationNum = pricingType !== "FLAT" ? Math.max(1, Number(form.watch("duration")) || 1) : 1;
  const rawDiscount = Number(form.watch("discount")) || 0;
  const discountNum =
    discountMode === "%" ? Math.round((qtyNum * priceNum * durationNum * rawDiscount) / 100 * 100) / 100 : rawDiscount;
  const isOptional = form.watch("isOptional") ?? false;
  const summaryTotal = Math.max(0, qtyNum * priceNum * durationNum - discountNum);
  const showSummary = name.trim().length > 0 && priceNum > 0;

  return (
    <form onSubmit={form.handleSubmit((d) => addMut.mutate(d))} className="space-y-6">
      {/* Item */}
      <section className="space-y-4">
        <SectionTitle title="Item" hint="What you're adding and where it lands." />
        <Field label="Name" htmlFor="custom-item-name" required>
          <Input
            id="custom-item-name"
            placeholder="e.g. 2x SM58 (borrowed), client cable drum"
            maxLength={200}
            {...form.register("description")}
          />
        </Field>
        <PlacementFields
          categories={categories}
          categoryId={categoryId}
          groupId={groupId}
          onChange={({ categoryId, groupId }) => {
            setCategoryId(categoryId);
            setGroupId(groupId);
          }}
        />
      </section>

      {/* Pricing */}
      <section className="space-y-4 border-t border-line pt-5">
        <SectionTitle title="Pricing" hint="Quantity, rate, and how it's charged." />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" htmlFor="custom-item-qty">
            <Input id="custom-item-qty" type="number" min={1} {...form.register("quantity")} />
          </Field>
          <Field label="Unit price ($)" htmlFor="custom-item-price">
            <Input
              id="custom-item-price"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              {...form.register("unitPrice")}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pricing type" htmlFor="custom-item-pricing-type">
            <Controller
              control={form.control}
              name="pricingType"
              render={({ field }) => (
                <Select
                  value={field.value ?? "FLAT"}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id="custom-item-pricing-type">
                    <SelectValue>{PRICING_LABELS[(field.value ?? "FLAT") as CustomItemPricingType]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PRICING_ORDER.map((p) => (
                      <SelectItem key={p} value={p}>{PRICING_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {pricingType !== "FLAT" && (
            <Field label="Duration" htmlFor="custom-item-duration">
              <Input id="custom-item-duration" type="number" min={1} {...form.register("duration")} />
            </Field>
          )}
        </div>
        <Controller
          control={form.control}
          name="discount"
          render={({ field }) => (
            <DiscountField
              id="custom-item-discount"
              value={field.value == null ? "" : String(field.value)}
              onValueChange={field.onChange}
              mode={discountMode}
              onModeChange={setDiscountMode}
            />
          )}
        />
        <label className="flex cursor-pointer items-center gap-2.5">
          <Controller
            control={form.control}
            name="isOptional"
            render={({ field }) => (
              <Checkbox
                id="custom-item-optional"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <span className="text-ui-text text-ink-2">Optional item (excluded from project total)</span>
        </label>
      </section>

      {/* Notes */}
      <section className="space-y-4 border-t border-line pt-5">
        <SectionTitle title="Notes" hint="Optional — context for the docket." />
        <Field label="Notes" htmlFor="custom-item-notes">
          <Textarea
            id="custom-item-notes"
            placeholder="Optional notes…"
            rows={2}
            {...form.register("notes")}
          />
        </Field>
      </section>

      {showSummary && (
        <div className="rounded-[var(--r)] border border-line bg-paper-2/50 px-3 py-2 text-caption text-ink-2">
          Adding <span className="font-medium text-ink">{qtyNum}×</span> {name.trim()} —{" "}
          <span className="t-data font-medium text-ink">${summaryTotal.toFixed(2)}</span>
          {isOptional && <span className="text-muted"> (optional, not in total)</span>}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={addMut.isPending}
          disabled={!name.trim() || !lineItemWrites.enabled}
        >
          Add item
        </Button>
      </DialogFooter>
    </form>
  );
}
