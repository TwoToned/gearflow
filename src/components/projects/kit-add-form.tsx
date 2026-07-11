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
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import { addKitLineItem, checkKitAvailability } from "@/server/line-items";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { PlacementFields } from "./placement-fields";
import type { CategoryData } from "./equipment-rows";
import { useActiveOrganization } from "@/lib/auth-client";
import { useKitSearch, useKit } from "@/hooks/use-kits";
import { useCategories } from "@/hooks/use-categories";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type KitPricingMode = "KIT_PRICE" | "ITEMIZED";

export interface KitAddFormProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  /** Pre-set category for the line item. */
  categoryId?: string;
  /** Pre-set group for the line item. */
  groupId?: string;
  /** Available categories (with groups) for the shared placement picker. */
  categories?: CategoryData[];
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
  categories,
  targetLabel,
  onInvalidate,
  onClose,
}: KitAddFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [selectedKitId, setSelectedKitId] = useState("");
  const [kitPricingMode, setKitPricingMode] = useState<KitPricingMode>("KIT_PRICE");
  const [kitUnitPrice, setKitUnitPrice] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState(categoryId ?? "");
  const [selectedGroupId, setSelectedGroupId] = useState(groupId ?? "");

  // Phase 7 — native INDEXED kit search (name OR assetTag, prep excluded server-side,
  // bounded + reactive) instead of loading the whole org list to JS-filter. Debounced
  // as the user types; re-apply the active filter + resolve the category name.
  const [kitQuery, setKitQuery] = useState("");
  const debouncedKitQuery = useDebouncedValue(kitQuery, 200);
  const kits = useKitSearch(orgId, debouncedKitQuery);
  const orgCategories = useCategories(orgId);
  const kitOptions = useMemo(() => {
    const categoryNameById = new Map((orgCategories ?? []).map((c) => [c.id, c.name]));
    return (kits ?? [])
      .filter((kit) => kit.isActive === true)
      .map((kit) => ({
        value: kit.id,
        label: `${kit.assetTag} - ${kit.name}`,
        description: kit.categoryId ? categoryNameById.get(kit.categoryId) : undefined,
      }));
  }, [kits, orgCategories]);
  // Resolve the selected kit's label directly (it may not be in the current search page).
  const selectedKit = useKit(selectedKitId || undefined);
  const selectedKitLabel = selectedKit ? `${selectedKit.assetTag} - ${selectedKit.name}` : undefined;

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
        (categoryId || selectedCategoryId) || undefined,
        (groupId || selectedGroupId) || undefined,
      ),
    onSuccess: () => {
      onInvalidate();
      refreshProjectDetail(projectId);
      toast.success("Kit added to project");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unavailable = !!selectedKitId && kitAvailability && !kitAvailability.available;

  return (
    <>
      <div className="space-y-6 py-2">
        {targetLabel && (
          <div className="rounded-[var(--r)] border border-line bg-paper-2/50 px-3 py-2 text-caption text-ink-2">
            Adding to <span className="font-medium text-ink">{targetLabel}</span>
          </div>
        )}

        {/* Kit */}
        <section className="space-y-4">
          <SectionTitle title="Kit" hint="Pick a kit to add to this project." />
          <Field label="Kit" required>
            <ComboboxPicker
              value={selectedKitId}
              onChange={setSelectedKitId}
              options={kitOptions}
              onSearchChange={setKitQuery}
              loading={kits === undefined}
              selectedLabel={selectedKitLabel}
              placeholder="Search kits…"
              searchPlaceholder="Search by tag or name…"
              emptyMessage="No kits found."
            />
          </Field>

          {unavailable && (
            <div className="flex items-start gap-2 rounded-[var(--r)] border-l-[3px] border-t-out bg-out-soft px-3 py-2 text-caption text-t-out">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Kit is unavailable: {kitAvailability!.conflictsWith}</span>
            </div>
          )}
        </section>

        {/* Pricing */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Pricing" hint="Charge the kit as one line or itemise its contents." />
          <Field label="Pricing mode">
            <div className="grid grid-cols-2 gap-2">
              <PricingModeOption
                label="Kit price"
                hint="One price for the whole kit."
                selected={kitPricingMode === "KIT_PRICE"}
                onSelect={() => setKitPricingMode("KIT_PRICE")}
              />
              <PricingModeOption
                label="Itemized"
                hint="Each item priced individually."
                selected={kitPricingMode === "ITEMIZED"}
                onSelect={() => setKitPricingMode("ITEMIZED")}
              />
            </div>
          </Field>

          {kitPricingMode === "KIT_PRICE" && (
            <Field label="Unit price ($)">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={kitUnitPrice}
                onChange={(e) => setKitUnitPrice(e.target.value)}
              />
            </Field>
          )}
        </section>

        {/* Placement — same Category + Group picker as the other add screens.
            Hidden when launched from a specific category/group context. */}
        {!targetLabel && categories && categories.length > 0 && (
          <section className="space-y-4 border-t border-line pt-5">
            <SectionTitle title="Placement" hint="Where the kit lands on the project." />
            <PlacementFields
              categories={categories}
              categoryId={selectedCategoryId}
              groupId={selectedGroupId}
              onChange={({ categoryId, groupId }) => {
                setSelectedCategoryId(categoryId);
                setSelectedGroupId(groupId);
              }}
            />
          </section>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => addKitMut.mutate()}
          loading={addKitMut.isPending}
          disabled={!selectedKitId || !!unavailable}
        >
          Add kit
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

function PricingModeOption({
  label, hint, selected, onSelect,
}: {
  label: string; hint: string; selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-[var(--r)] border-2 px-3 py-2 text-left transition-colors",
        focusRing,
        selected
          ? "border-red bg-red-soft"
          : "border-line bg-paper-2/50 hover:border-line-2",
      )}
    >
      <span className={cn("text-ui-text font-medium", selected ? "text-ink" : "text-ink-2")}>
        {label}
      </span>
      <span className="t-micro text-muted">{hint}</span>
    </button>
  );
}
