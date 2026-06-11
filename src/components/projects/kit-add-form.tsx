"use client";

/**
 * Kit add form — the body of the "Add Kit to Project" flow, extracted
 * from equipment-tab.tsx so it can be embedded both in its own dialog and
 * in the unified add dialog (Phase 4 of cross-type unification).
 *
 * Renders the kit picker, availability warning, pricing-mode radio, optional
 * unit-price input, and the Add Kit submit button. No Dialog wrapper — the
 * caller supplies that.
 */

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";

import { addKitLineItem, checkKitAvailability } from "@/server/line-items";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";
import { useKits } from "@/hooks/use-kits";
import { useCategories } from "@/hooks/use-categories";

type KitPricingMode = "KIT_PRICE" | "ITEMIZED";

export interface KitAddFormProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  /** Pre-set category for the line item. */
  categoryId?: string;
  /** Pre-set group for the line item. */
  groupId?: string;
  /** Human-readable label like "Audio > PA System" when adding inside a group. */
  targetLabel?: string;
  /** Invalidate queries after a successful add. */
  onInvalidate: () => void;
  /** Close the surrounding dialog. */
  onClose: () => void;
}

export function KitAddForm({
  projectId,
  rentalStartDate,
  rentalEndDate,
  categoryId,
  groupId,
  targetLabel,
  onInvalidate,
  onClose,
}: KitAddFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [selectedKitId, setSelectedKitId] = useState("");
  const [kitPricingMode, setKitPricingMode] = useState<KitPricingMode>("KIT_PRICE");
  const [kitUnitPrice, setKitUnitPrice] = useState("");

  // Reactive kit list (Convex). The org-scoped list returns all kits; re-apply
  // getKits's default filter (active, non-prep) and assetTag sort client-side,
  // and resolve the category name from the reactive categories list.
  const kits = useKits(orgId);
  const categories = useCategories(orgId);
  const kitOptions = useMemo(() => {
    const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
    return (kits ?? [])
      .filter((kit) => kit.isActive === true && kit.isPrep === false)
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag))
      .map((kit) => ({
        value: kit.id,
        label: `${kit.assetTag} - ${kit.name}`,
        description: kit.categoryId ? categoryNameById.get(kit.categoryId) : undefined,
      }));
  }, [kits, categories]);

  const { data: kitAvailability } = useServerQuery({
    queryKey: ["kit-availability", orgId, selectedKitId, projectId],
    queryFn: () =>
      checkKitAvailability(
        selectedKitId,
        rentalStartDate ?? new Date(),
        rentalEndDate ?? new Date(),
        projectId
      ),
    enabled: !!selectedKitId,
  });

  const addKitMut = useServerMutation({
    mutationFn: () =>
      addKitLineItem(
        projectId,
        selectedKitId,
        kitPricingMode,
        kitPricingMode === "KIT_PRICE" && kitUnitPrice ? parseFloat(kitUnitPrice) : undefined,
        undefined, // groupName
        categoryId,
        groupId,
      ),
    onSuccess: () => {
      onInvalidate();
      refreshProjectDetail(projectId);
      toast.success("Kit added to project");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="space-y-4 py-2">
        {targetLabel && (
          <div className="rounded-md bg-accent/50 px-3 py-2 text-xs text-fg-3">
            Adding to <span className="font-medium text-fg">{targetLabel}</span>
          </div>
        )}
        <div className="space-y-2">
          <Label>Kit</Label>
          <ComboboxPicker
            value={selectedKitId}
            onChange={setSelectedKitId}
            options={kitOptions}
            placeholder="Select a kit..."
            searchPlaceholder="Search kits..."
            emptyMessage="No kits found."
          />
        </div>

        {selectedKitId && kitAvailability && !kitAvailability.available && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Kit is unavailable: {kitAvailability.conflictsWith}
          </div>
        )}

        <div className="space-y-2">
          <Label>Pricing Mode</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="kitPricingMode"
                value="KIT_PRICE"
                checked={kitPricingMode === "KIT_PRICE"}
                onChange={() => setKitPricingMode("KIT_PRICE")}
                className="accent-primary"
              />
              Kit Price
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="kitPricingMode"
                value="ITEMIZED"
                checked={kitPricingMode === "ITEMIZED"}
                onChange={() => setKitPricingMode("ITEMIZED")}
                className="accent-primary"
              />
              Itemized
            </label>
          </div>
          <p className="text-xs text-fg-3">
            {kitPricingMode === "KIT_PRICE"
              ? "One price for the whole kit."
              : "Each item in the kit priced individually."}
          </p>
        </div>

        {kitPricingMode === "KIT_PRICE" && (
          <div className="space-y-2">
            <Label>Unit Price</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={kitUnitPrice}
              onChange={(e) => setKitUnitPrice(e.target.value)}
            />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={() => addKitMut.mutate()}
          disabled={
            !selectedKitId ||
            addKitMut.isPending ||
            (kitAvailability && !kitAvailability.available)
          }
        >
          {addKitMut.isPending ? "Adding..." : "Add Kit"}
        </Button>
      </DialogFooter>
    </>
  );
}
