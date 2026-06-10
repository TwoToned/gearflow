"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { Loader2, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { archiveKit, deleteKit, canDeleteKit } from "@/server/kits";

interface DeleteKitDialogProps {
  kitId: string;
  kitLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (result: { hardDeleted: boolean }) => void;
}

type DeleteMode = "archive" | "hard";

export function DeleteKitDialog({
  kitId,
  kitLabel,
  open,
  onOpenChange,
  onDeleted,
}: DeleteKitDialogProps) {
  const [mode, setMode] = useState<DeleteMode>("archive");

  const { data: info, isLoading: infoLoading } = useServerQuery({
    queryKey: ["kit-delete-info", kitId],
    queryFn: () => canDeleteKit(kitId),
    enabled: open,
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveKit(kitId),
    onSuccess: () => {
      toast.success(`Archived ${kitLabel}`);
      onOpenChange(false);
      onDeleted?.({ hardDeleted: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteKit(kitId),
    onSuccess: () => {
      toast.success(`Deleted ${kitLabel} permanently`);
      onOpenChange(false);
      onDeleted?.({ hardDeleted: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = archiveMutation.isPending || deleteMutation.isPending;
  const canArchive = info?.canArchive ?? false;
  const canHardDelete = info?.canHardDelete ?? false;

  function handleConfirm() {
    if (mode === "archive") archiveMutation.mutate();
    else deleteMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete kit</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-fg-2">
            What should happen to <span className="font-mono text-fg">{kitLabel}</span>?
          </p>

          {infoLoading && (
            <div className="flex items-center gap-2 text-fg-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking references…
            </div>
          )}

          {!infoLoading && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={!canArchive || pending}
                onClick={() => setMode("archive")}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  mode === "archive"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border-strong"
                } ${!canArchive ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Archive className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-2" />
                  <div className="space-y-1">
                    <div className="font-medium text-fg">Archive (recommended)</div>
                    <p className="text-xs text-fg-3">
                      Releases all contents, hides the kit from lists. Preserves history on past
                      projects. Can be recovered later.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={!canHardDelete || pending}
                onClick={() => setMode("hard")}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  mode === "hard"
                    ? "border-destructive bg-destructive/5"
                    : "border-border hover:border-border-strong"
                } ${!canHardDelete ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Trash2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <div className="space-y-1">
                    <div className="font-medium text-fg">Delete permanently</div>
                    <p className="text-xs text-fg-3">
                      Releases contents and removes the kit row entirely. Cannot be undone.
                      {!canHardDelete && info?.reason && (
                        <span className="mt-1 block text-destructive">{info.reason}</span>
                      )}
                    </p>
                  </div>
                </div>
              </button>

              {!canArchive && info?.reason && (
                <p className="text-xs text-destructive">{info.reason}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant={mode === "hard" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={
              pending ||
              infoLoading ||
              (mode === "archive" && !canArchive) ||
              (mode === "hard" && !canHardDelete)
            }
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "archive" ? "Archive kit" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
