"use client";

/**
 * Custom-item add form — the body of the "Add Custom Item" flow, extracted
 * from equipment-tab.tsx so it can be embedded both in its own dialog and in
 * the unified add dialog (Phase 4 of cross-type unification).
 *
 * Renders the fields + footer (Cancel / Add Item) and owns the
 * addCustomLineItem mutation. No Dialog wrapper — the caller supplies that.
 */

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { toast } from "sonner";

import { addCustomLineItem } from "@/server/line-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
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
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [pricingType, setPricingType] = useState<CustomItemPricingType>("FLAT");
  const [duration, setDuration] = useState("1");
  const [discount, setDiscount] = useState("");
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [groupId, setGroupId] = useState(defaultGroupId ?? "");

  const addMut = useServerMutation({
    mutationFn: (data: Parameters<typeof addCustomLineItem>[1]) => addCustomLineItem(projectId, data),
    onSuccess: () => {
      onInvalidate();
      refreshProjectDetail(projectId);
      toast.success("Custom item added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const groupOptions = selectedCategory?.groups ?? [];

  // ─── Live summary ──────────────────────────────────────────────
  const qtyNum = Math.max(1, parseInt(qty) || 1);
  const priceNum = price !== "" ? parseFloat(price) : 0;
  const durationNum = pricingType !== "FLAT" ? Math.max(1, parseInt(duration) || 1) : 1;
  const discountNum = discount !== "" ? parseFloat(discount) : 0;
  const summaryTotal = Math.max(0, qtyNum * priceNum * durationNum - discountNum);
  const showSummary = name.trim().length > 0 && priceNum > 0;

  return (
    <>
      <div className="space-y-6 py-2">
        {/* Item */}
        <section className="space-y-4">
          <SectionTitle title="Item" hint="What you're adding and where it lands." />
          <Field label="Name" required>
            <Input
              id="custom-item-name"
              placeholder="e.g. 2x SM58 (borrowed), client cable drum"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select
                value={categoryId || "__none__"}
                onValueChange={(val) => {
                  setCategoryId(val === "__none__" ? "" : val);
                  setGroupId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue>{selectedCategory?.name ?? "Uncategorized"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Uncategorized</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Group">
              <Select
                value={groupId || "__none__"}
                onValueChange={(val) => setGroupId(val === "__none__" ? "" : val)}
                disabled={!categoryId}
              >
                <SelectTrigger>
                  <SelectValue>
                    {groupOptions.find((g) => g.id === groupId)?.title ?? "No group"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No group</SelectItem>
                  {groupOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        {/* Pricing */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Pricing" hint="Quantity, rate, and how it's charged." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                id="custom-item-qty"
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            <Field label="Unit price ($)">
              <Input
                id="custom-item-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pricing type">
              <Select
                value={pricingType}
                onValueChange={(val) => setPricingType(val as CustomItemPricingType)}
              >
                <SelectTrigger>
                  <SelectValue>{PRICING_LABELS[pricingType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRICING_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>{PRICING_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {pricingType !== "FLAT" && (
              <Field label="Duration">
                <Input
                  id="custom-item-duration"
                  type="number"
                  min="1"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
            )}
          </div>
          <Field label="Discount ($)">
            <Input
              id="custom-item-discount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox
              id="custom-item-optional"
              checked={isOptional}
              onCheckedChange={(c) => setIsOptional(c === true)}
            />
            <span className="text-ui-text text-ink-2">Optional item (excluded from project total)</span>
          </label>
        </section>

        {/* Notes */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Notes" hint="Optional — context for the docket." />
          <Field label="Notes">
            <Textarea
              id="custom-item-notes"
              placeholder="Optional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
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
      </div>

      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          loading={addMut.isPending}
          disabled={!name.trim()}
          onClick={() => {
            addMut.mutate({
              description: name.trim(),
              quantity: parseInt(qty) || 1,
              unitPrice: price !== "" ? parseFloat(price) : undefined,
              pricingType,
              duration: pricingType !== "FLAT" ? (parseInt(duration) || 1) : 1,
              discount: discount !== "" ? parseFloat(discount) : undefined,
              isOptional,
              notes: notes.trim() || undefined,
              categoryId: categoryId || undefined,
              groupId: groupId || undefined,
            });
          }}
        >
          Add item
        </Button>
      </DialogFooter>
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
