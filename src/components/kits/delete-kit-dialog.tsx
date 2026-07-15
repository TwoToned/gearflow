"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { Loader2, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing, disabledState } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useKitWrites } from "@/hooks/use-kit-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";

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
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: info, isLoading: infoLoading } = useServerQuery({
    queryKey: ["kit-delete-info", orgId, kitId],
    queryFn: () => convex.query(api.kits.deletability, { orgId: orgId!, id: kitId }),
    enabled: open && !!orgId && isAuthenticated,
  });

  const kitWrites = useKitWrites();

  const archiveMutation = useServerMutation({
    mutationFn: () => kitWrites.archive(kitId),
    onSuccess: () => {
      toast.success(`Archived ${kitLabel}`);
      onOpenChange(false);
      onDeleted?.({ hardDeleted: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => kitWrites.remove(kitId),
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

        <div className="space-y-4 text-ui-text">
          <p className="text-ink-2">
            What should happen to <span className="t-mono text-ink">{kitLabel}</span>?
          </p>

          {infoLoading && (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Checking references…
            </div>
          )}

          {!infoLoading && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={!canArchive || pending}
                onClick={() => setMode("archive")}
                className={cn(
                  "w-full rounded-[var(--r)] border-2 p-3 text-left transition-colors",
                  mode === "archive"
                    ? "border-red bg-red-soft"
                    : "border-line hover:border-line-2",
                  focusRing,
                  disabledState,
                )}
              >
                <div className="flex items-start gap-3">
                  <Archive className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-2" />
                  <div className="space-y-1">
                    <div className="font-medium text-ink">Archive (recommended)</div>
                    <p className="text-caption text-muted">
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
                className={cn(
                  "w-full rounded-[var(--r)] border-2 p-3 text-left transition-colors",
                  mode === "hard"
                    ? "border-t-out bg-out-soft"
                    : "border-line hover:border-line-2",
                  focusRing,
                  disabledState,
                )}
              >
                <div className="flex items-start gap-3">
                  <Trash2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-t-out" />
                  <div className="space-y-1">
                    <div className="font-medium text-ink">Delete permanently</div>
                    <p className="text-caption text-muted">
                      Releases contents and removes the kit row entirely. Cannot be undone.
                      {!canHardDelete && info?.reason && (
                        <span className="mt-1 block text-t-out">{info.reason}</span>
                      )}
                    </p>
                  </div>
                </div>
              </button>

              {!canArchive && info?.reason && (
                <p className="text-caption text-t-out">{info.reason}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="line"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant={mode === "hard" ? "line" : "primary"}
            className={mode === "hard" ? "border-t-out/40 text-t-out hover:bg-out-soft hover:border-t-out" : undefined}
            onClick={handleConfirm}
            loading={pending}
            disabled={
              infoLoading ||
              (mode === "archive" && !canArchive) ||
              (mode === "hard" && !canHardDelete)
            }
          >
            {mode === "archive" ? "Archive kit" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
