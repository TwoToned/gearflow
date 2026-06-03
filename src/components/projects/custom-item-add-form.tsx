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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addCustomLineItem } from "@/server/line-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import type { CategoryData } from "./equipment-rows";

type CustomItemPricingType = "PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR";

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
  const queryClient = useQueryClient();
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

  const addMut = useMutation({
    mutationFn: (data: Parameters<typeof addCustomLineItem>[1]) => addCustomLineItem(projectId, data),
    onSuccess: () => {
      onInvalidate();
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Custom item added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="custom-item-name">Name <span className="text-error">*</span></Label>
          <Input
            id="custom-item-name"
            placeholder="e.g. 2x SM58 (borrowed), Client cable drum"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setGroupId("");
              }}
            >
              <option value="">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Group</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={!categoryId}
            >
              <option value="">No group</option>
              {categoryId && categories
                .find((c) => c.id === categoryId)
                ?.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="custom-item-qty">Quantity</Label>
            <Input
              id="custom-item-qty"
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-item-price">Unit Price</Label>
            <Input
              id="custom-item-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Pricing Type</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={pricingType}
              onChange={(e) => setPricingType(e.target.value as CustomItemPricingType)}
            >
              <option value="FLAT">Flat</option>
              <option value="PER_DAY">Per Day</option>
              <option value="PER_WEEK">Per Week</option>
              <option value="PER_HOUR">Per Hour</option>
            </select>
          </div>
          {pricingType !== "FLAT" && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-item-duration">Duration</Label>
              <Input
                id="custom-item-duration"
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="custom-item-discount">Discount</Label>
            <Input
              id="custom-item-discount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 pt-7">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
              />
              Optional (excluded from project total)
            </Label>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-item-notes">Notes</Label>
          <Textarea
            id="custom-item-notes"
            placeholder="Optional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!name.trim() || addMut.isPending}
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
          {addMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Item
        </Button>
      </DialogFooter>
    </>
  );
}
