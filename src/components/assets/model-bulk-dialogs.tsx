"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, FileText, ListChecks, Ruler } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCheckItemWrites } from "@/hooks/use-check-item-writes";
import { useCheckItems } from "@/hooks/use-check-items";
import { useModelWrites } from "@/hooks/use-model-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import { cn, focusRing } from "@/lib/utils";

/**
 * The Models list's two bulk dialogs (moved out of the retired `model-table.tsx`, UX Phase 14):
 * `Edit rates n` and `Assign checks n`. Same behaviour, same mutations.
 */

type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";

const TYPE_LABELS: Record<CheckItemType, string> = {
  PASS_FAIL: "Pass / fail",
  NOTES: "Notes",
  MEASUREMENT: "Measurement",
  DROPDOWN: "Dropdown",
};

const TYPE_ICONS: Record<CheckItemType, typeof CheckCircle2> = {
  PASS_FAIL: CheckCircle2,
  NOTES: FileText,
  MEASUREMENT: Ruler,
  DROPDOWN: ListChecks,
};

// Badge intent per check-item type, mirroring model-checks-tab.tsx.
const TYPE_STATUS: Record<CheckItemType, "ok" | "warn" | "neutral"> = {
  PASS_FAIL: "ok",
  NOTES: "neutral",
  MEASUREMENT: "warn",
  DROPDOWN: "neutral",
};

interface BulkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelIds: Set<string>;
  onSuccess: () => void;
}

export function BulkAssignChecksDialog({ open, onOpenChange, selectedModelIds, onSuccess }: BulkDialogProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [selectedCheckIds, setSelectedCheckIds] = useState<Set<string>>(new Set());

  // Subscribe to the check-item library only while the dialog is open.
  const allCheckItemsData = useCheckItems(open ? orgId : undefined);
  const allCheckItems = allCheckItemsData ?? [];
  const isLoading = allCheckItemsData === undefined;
  const writes = useCheckItemWrites();

  const mutation = useServerMutation({
    mutationFn: () => writes.bulkAddCheckItemsToModels(Array.from(selectedModelIds), Array.from(selectedCheckIds)),
    onSuccess: (result) => {
      if (result.count === 0) toast.success("All selected checks were already assigned");
      else {
        // ONE guarded Undo closure; the server removes exactly the assignments this call created.
        announceListWrite({
          title: `Assigned checks to ${plural(selectedModelIds.size, "model")} (${result.count} new)`,
          undoneTitle: "Assignments removed",
          performUndo: async () => {
            const u = await writes.undoAssignChecks(result.auditId);
            return u.left > 0 ? `Removed ${u.removed} · ${u.left} had changed since and stay` : undefined;
          },
        });
      }
      setSelectedCheckIds(new Set());
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = allCheckItems as Record<string, unknown>[];

  const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
    const cat = (item.category as string) || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
  const sortedCategories = Object.keys(grouped).sort((a, b) =>
    a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b),
  );

  function toggleCheckItem(id: string) {
    setSelectedCheckIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedCheckIds(selectedCheckIds.size === items.length ? new Set() : new Set(items.map((i) => i.id as string)));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setSelectedCheckIds(new Set());
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Assign checks to {selectedModelIds.size} model{selectedModelIds.size !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <p className="text-ui-text text-muted">Select check items to assign. Already-assigned items will be skipped.</p>

        {isLoading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-[var(--r)]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted">
            <ClipboardCheck className="mb-2 h-6 w-6 opacity-50" />
            <p className="text-ui-text">No check items in the library yet.</p>
            <Link href="/settings/check-items" className={cn("mt-2 text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}>
              Create check items in settings
            </Link>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-3">
            <button
              type="button"
              onClick={toggleAll}
              className={cn("flex w-full items-center gap-3 rounded-[var(--r)] px-3 py-2 text-left text-ui-text font-medium text-ink motion-safe:transition-colors hover:bg-elev", focusRing)}
            >
              <Checkbox checked={selectedCheckIds.size === items.length ? true : selectedCheckIds.size > 0 ? "indeterminate" : false} />
              <span>Select all ({items.length})</span>
            </button>

            <div className="h-px bg-line" />

            {sortedCategories.map((category) => (
              <div key={category}>
                <p className="px-3 t-overline text-muted mb-1">{category}</p>
                {grouped[category].map((item) => {
                  const type = item.type as CheckItemType;
                  const Icon = TYPE_ICONS[type];
                  const isSelected = selectedCheckIds.has(item.id as string);
                  return (
                    <button
                      key={item.id as string}
                      type="button"
                      onClick={() => toggleCheckItem(item.id as string)}
                      className={cn("flex w-full items-center gap-3 rounded-[var(--r)] px-3 py-2 text-left motion-safe:transition-colors hover:bg-elev", focusRing)}
                    >
                      <Checkbox checked={isSelected} />
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="text-ui-text font-medium text-ink truncate">{item.label as string}</p>
                      </div>
                      <Badge status={TYPE_STATUS[type]} className="shrink-0">
                        {TYPE_LABELS[type]}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={selectedCheckIds.size === 0}>
            Assign {selectedCheckIds.size} check{selectedCheckIds.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RATE_TYPE_LABELS: Record<string, string> = {
  dailyRate: "Daily rate",
  weeklyRate: "Weekly rate",
  monthlyRate: "Monthly rate",
  // WS11 (#950) — sales items.
  salePrice: "Sale price",
};

const OPERATION_LABELS: Record<string, string> = {
  set: "Set fixed amount",
  multiply: "Multiply by factor",
  increase_percent: "Increase by %",
};

export function BulkRateUpdateDialog({ open, onOpenChange, selectedModelIds, onSuccess }: BulkDialogProps) {
  const [rateType, setRateType] = useState<"dailyRate" | "weeklyRate" | "monthlyRate" | "salePrice">("dailyRate");
  const [operation, setOperation] = useState<"set" | "multiply" | "increase_percent">("set");
  const [value, setValue] = useState("");
  const modelWrites = useModelWrites();

  const mutation = useServerMutation({
    mutationFn: () => modelWrites.bulkUpdateRates(Array.from(selectedModelIds), rateType, operation, Number(value)),
    onSuccess: (result) => {
      // ONE guarded Undo closure; the server refuses if any of these rates changed since.
      announceListWrite({
        title: `Updated ${RATE_TYPE_LABELS[rateType]} on ${plural(result.count, "model")}`,
        undoneTitle: "Rates restored",
        performUndo: result.auditIds.length > 0 ? async () => void (await modelWrites.undoModelFieldEdits(result.auditIds)) : undefined,
      });
      setValue("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit rates — {selectedModelIds.size} model{selectedModelIds.size !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Rate type</Label>
            <Select value={rateType} onValueChange={(v) => setRateType(v as typeof rateType)}>
              <SelectTrigger>
                <SelectValue>{RATE_TYPE_LABELS[rateType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dailyRate">Daily rate</SelectItem>
                <SelectItem value="weeklyRate">Weekly rate</SelectItem>
                <SelectItem value="monthlyRate">Monthly rate</SelectItem>
                <SelectItem value="salePrice">Sale price</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Operation</Label>
            <Select value={operation} onValueChange={(v) => setOperation(v as typeof operation)}>
              <SelectTrigger>
                <SelectValue>{OPERATION_LABELS[operation]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Set fixed amount</SelectItem>
                <SelectItem value="multiply">Multiply by factor</SelectItem>
                <SelectItem value="increase_percent">Increase by %</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{operation === "set" ? "Amount ($)" : operation === "multiply" ? "Factor" : "Percentage (%)"}</Label>
            <Input
              type="number"
              step={operation === "set" ? "0.01" : "0.1"}
              min={operation === "set" ? "0" : operation === "multiply" ? "0.01" : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={operation === "set" ? "e.g. 100.00" : operation === "multiply" ? "e.g. 1.1" : "e.g. 10"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!value || Number(value) === 0}>
            {mutation.isPending ? `Updating ${selectedModelIds.size} models...` : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
