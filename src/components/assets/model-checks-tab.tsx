"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Ruler,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import {
  getModelCheckItems,
  getCheckItems,
  addCheckItemToModel,
  removeCheckItemFromModel,
  reorderModelCheckItems,
} from "@/server/check-items";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";

const TYPE_LABELS: Record<CheckItemType, string> = {
  PASS_FAIL: "Pass / Fail",
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

const TYPE_COLORS: Record<CheckItemType, string> = {
  PASS_FAIL: "bg-green-500/10 text-green-500 border-green-500/20",
  NOTES: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  MEASUREMENT: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  DROPDOWN: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

export function ModelChecksTab({ modelId }: { modelId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const canEdit = useCanDo("checkItem", "update");

  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: modelCheckItems = [], isLoading } = useQuery({
    queryKey: ["model-check-items", orgId, modelId],
    queryFn: () => getModelCheckItems(modelId),
  });

  const removeMutation = useMutation({
    mutationFn: (checkItemId: string) =>
      removeCheckItemFromModel(modelId, checkItemId),
    onSuccess: () => {
      toast.success("Check item removed");
      queryClient.invalidateQueries({
        queryKey: ["model-check-items", orgId, modelId],
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const items = modelCheckItems as Record<string, unknown>[];

  // Drag reorder via move up/down buttons (simpler than DnD for now)
  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      reorderModelCheckItems({ modelId, orderedCheckItemIds: orderedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["model-check-items", orgId, modelId],
      });
    },
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-3">
          Check items assigned to this model will appear during warehouse prep &amp; return.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Check
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-fg-3">
          <ClipboardCheck className="mb-2 h-8 w-8 opacity-50" />
          <p className="font-medium">No check items assigned</p>
          <p className="mt-1 text-xs">
            Add check items from the{" "}
            <Link href="/settings/check-items" className="text-primary hover:underline">
              library
            </Link>{" "}
            to enable quality checks for this model.
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && <TableHead className="w-10" />}
                <TableHead className="w-8">#</TableHead>
                <TableHead>Check Item</TableHead>
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
                            className="text-fg-3 hover:text-fg disabled:opacity-20 p-0.5"
                            onClick={() => moveItem(index, "up")}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M6 3L10 8H2L6 3Z" fill="currentColor" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            disabled={index === items.length - 1}
                            className="text-fg-3 hover:text-fg disabled:opacity-20 p-0.5"
                            onClick={() => moveItem(index, "down")}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M6 9L2 4H10L6 9Z" fill="currentColor" />
                            </svg>
                          </button>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-fg-3 text-sm">{index + 1}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{ci.label as string}</span>
                        {ci.description ? (
                          <p className="mt-0.5 text-xs text-fg-3 line-clamp-1">
                            {ci.description as string}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TYPE_COLORS[type]}>
                        <Icon className="mr-1 h-3 w-3" />
                        {TYPE_LABELS[type]}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`Remove "${ci.label}" from this model?`)) {
                              removeMutation.mutate(ci.id as string);
                            }
                          }}
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

      <CheckItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        modelId={modelId}
        existingCheckItemIds={items.map((i) => {
          const ci = i.checkItem as Record<string, unknown>;
          return ci.id as string;
        })}
      />
    </div>
  );
}

// ─── Check Item Picker Dialog ───────────────────────────────────────────────

function CheckItemPicker({
  open,
  onOpenChange,
  modelId,
  existingCheckItemIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  existingCheckItemIds: string[];
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  const { data: allCheckItems = [], isLoading } = useQuery({
    queryKey: ["check-items", orgId],
    queryFn: () => getCheckItems(),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (checkItemId: string) =>
      addCheckItemToModel(modelId, checkItemId),
    onSuccess: () => {
      toast.success("Check item added");
      queryClient.invalidateQueries({
        queryKey: ["model-check-items", orgId, modelId],
      });
      queryClient.invalidateQueries({ queryKey: ["check-items", orgId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const items = allCheckItems as Record<string, unknown>[];
  const available = items.filter(
    (i) => !existingCheckItemIds.includes(i.id as string)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Check Items</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-fg-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : available.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-fg-3">
            <ClipboardCheck className="mb-2 h-6 w-6 opacity-50" />
            <p className="text-sm">
              {items.length === 0
                ? "No check items in library yet."
                : "All check items already assigned."}
            </p>
            {items.length === 0 && (
              <Link
                href="/settings/check-items"
                className="mt-2 text-xs text-primary hover:underline"
              >
                Create check items in Settings
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
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-bg-elevated"
                >
                  <Icon className="h-4 w-4 shrink-0 text-fg-3" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.label as string}</p>
                    {item.category ? (
                      <p className="text-xs text-fg-3">{item.category as string}</p>
                    ) : null}
                  </div>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${TYPE_COLORS[type]}`}>
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
