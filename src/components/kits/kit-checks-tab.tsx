"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Plus,
  Trash2,
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Ruler,
  ListChecks,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import {
  addCheckItemToKit,
  removeCheckItemFromKit,
  reorderKitCheckItems,
} from "@/server/check-items";
import { useKitCheckItems } from "@/hooks/use-check-item-assignments";
import { useCheckItems } from "@/hooks/use-check-items";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, focusRing, disabledState } from "@/lib/utils";

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

const TYPE_STATUS: Record<CheckItemType, "ok" | "warn" | "neutral"> = {
  PASS_FAIL: "ok",
  NOTES: "neutral",
  MEASUREMENT: "warn",
  DROPDOWN: "neutral",
};

interface KitChecksTabProps {
  kitId: string;
  checkMode: string;
}

export function KitChecksTab({ kitId, checkMode }: KitChecksTabProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canEdit = useCanDo("checkItem", "update");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);
  const isPerItem = checkMode === "PER_ITEM";

  // Reactive list straight from Convex — add / remove / reorder via the
  // dual-write server actions push a live update, no manual invalidation. (In
  // PER_ITEM mode the list isn't rendered; the subscription is harmless.)
  const kitCheckItems = useKitCheckItems(orgId, kitId);
  const isLoading = kitCheckItems === undefined;

  const removeMutation = useServerMutation({
    mutationFn: (checkItemId: string) =>
      removeCheckItemFromKit(kitId, checkItemId),
    onSuccess: () => {
      toast.success("Check item removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const items = (kitCheckItems ?? []) as Record<string, unknown>[];

  const reorderMutation = useServerMutation({
    mutationFn: (orderedIds: string[]) =>
      reorderKitCheckItems(kitId, orderedIds),
    onError: (e) => toast.error(e.message),
  });

  function moveItem(index: number, direction: "up" | "down") {
    const ids = items.map((i) => {
      const ci = i.checkItem as Record<string, unknown>;
      return ci.id as string;
    });
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    [ids[index], ids[swapIdx]] = [ids[swapIdx], ids[index]];
    reorderMutation.mutate(ids);
  }

  // PER_ITEM mode — show info notice (left-edge accent bar, DESIGN Notices/Alerts)
  if (isPerItem) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-[var(--r)] border border-line border-l-2 border-l-blue bg-card p-4 shadow-[var(--sh-card)]">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
          <div>
            <p className="text-ui-text font-medium text-ink">Per item mode is active</p>
            <p className="mt-1 text-ui-text text-muted">
              This kit is set to <strong className="text-ink-2">Per item</strong> check mode. During warehouse operations,
              each asset in the kit will go through its own model&apos;s check items individually.
              To assign checks at the kit level instead, switch to <strong className="text-ink-2">Kit level</strong> mode
              in the kit settings.
            </p>
            <p className="mt-2 text-caption text-muted">
              To manage check items for individual models, visit the{" "}
              <Link href="/assets/models" className={cn("text-link hover:underline rounded-sm", focusRing)}>
                Models
              </Link>{" "}
              page and open the Checks tab on each model.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-[var(--r)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-table-cell text-muted">
          Check items assigned to this kit will appear during warehouse prep &amp; return.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" />
            Add check
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--r-lg)] border-2 border-dashed border-border py-12 text-center">
          <ClipboardCheck className="mb-2 h-8 w-8 text-faint" />
          <p className="text-ui-text font-medium text-ink-2">No check items assigned</p>
          <p className="mt-1 text-caption text-muted">
            Add check items from the{" "}
            <Link href="/settings/check-items" className={cn("text-link hover:underline rounded-sm", focusRing)}>
              library
            </Link>{" "}
            to enable quality checks for this kit.
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && <TableHead className="w-10" />}
                <TableHead className="w-8">#</TableHead>
                <TableHead>Check item</TableHead>
                <TableHead>Type</TableHead>
                {canEdit && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((mci, index) => {
                const ci = mci.checkItem as Record<string, unknown>;
                const type = ci.type as CheckItemType;
                const Icon = TYPE_ICONS[type];
                return (
                  <TableRow key={mci.id as string}>
                    {canEdit && (
                      <TableCell className="pr-0">
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={index === 0}
                            className={cn("text-muted hover:text-ink p-0.5 rounded-sm transition-colors", focusRing, disabledState)}
                            onClick={() => moveItem(index, "up")}
                            aria-label="Move up"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path d="M6 3L10 8H2L6 3Z" fill="currentColor" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            disabled={index === items.length - 1}
                            className={cn("text-muted hover:text-ink p-0.5 rounded-sm transition-colors", focusRing, disabledState)}
                            onClick={() => moveItem(index, "down")}
                            aria-label="Move down"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path d="M6 9L2 4H10L6 9Z" fill="currentColor" />
                            </svg>
                          </button>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-muted text-table-cell t-data">{index + 1}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium text-ink">{ci.label as string}</span>
                        {ci.description ? (
                          <p className="mt-0.5 text-caption text-muted line-clamp-1">
                            {ci.description as string}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge status={TYPE_STATUS[type]} className="gap-1">
                        <Icon className="h-3 w-3" />
                        {TYPE_LABELS[type]}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-t-out"
                          aria-label={`Remove ${ci.label as string}`}
                          onClick={() =>
                            setRemoveTarget({
                              id: ci.id as string,
                              label: ci.label as string,
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <KitCheckItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        kitId={kitId}
        existingCheckItemIds={items.map((i) => {
          const ci = i.checkItem as Record<string, unknown>;
          return ci.id as string;
        })}
      />
      <DeleteDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove "${removeTarget?.label ?? ""}" from this kit?`}
        description="The check item is removed from this kit's checklist template. Past check responses on previous projects are preserved."
        confirmLabel="Remove check"
        onConfirm={() => {
          if (removeTarget) {
            removeMutation.mutate(removeTarget.id);
            setRemoveTarget(null);
          }
        }}
        pending={removeMutation.isPending}
      />
    </div>
  );
}

// ─── Check Item Picker Dialog ───────────────────────────────────────────────

function KitCheckItemPicker({
  open,
  onOpenChange,
  kitId,
  existingCheckItemIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kitId: string;
  existingCheckItemIds: string[];
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const allCheckItems = useCheckItems(orgId);
  const isLoading = allCheckItems === undefined;

  const addMutation = useServerMutation({
    mutationFn: (checkItemId: string) =>
      addCheckItemToKit(kitId, checkItemId),
    onSuccess: () => {
      toast.success("Check item added");
    },
    onError: (e) => toast.error(e.message),
  });

  const items = (allCheckItems ?? []) as Record<string, unknown>[];
  const available = items.filter(
    (i) => !existingCheckItemIds.includes(i.id as string)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add check items</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-[var(--r)]" />
            ))}
          </div>
        ) : available.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ClipboardCheck className="mb-2 h-6 w-6 text-faint" />
            <p className="text-table-cell text-ink-2">
              {items.length === 0
                ? "No check items in library yet."
                : "All check items already assigned."}
            </p>
            {items.length === 0 && (
              <Link
                href="/settings/check-items"
                className={cn("mt-2 text-caption text-link hover:underline rounded-sm", focusRing)}
              >
                Create check items in settings
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {available.map((item) => {
              const type = item.type as CheckItemType;
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={item.id as string}
                  type="button"
                  onClick={() => addMutation.mutate(item.id as string)}
                  disabled={addMutation.isPending}
                  className={cn("flex w-full items-center gap-3 rounded-[var(--r)] px-3 py-2.5 text-left transition-colors hover:bg-paper-2", focusRing, disabledState)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-table-cell font-medium text-ink truncate">{item.label as string}</p>
                    {item.category ? (
                      <p className="text-caption text-muted">{item.category as string}</p>
                    ) : null}
                  </div>
                  <Badge status={TYPE_STATUS[type]} className="shrink-0">
                    {TYPE_LABELS[type]}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
