"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameContainerSchema, type RenameContainerFormValues } from "@/lib/validations/project-container";

/**
 * Rename a case from its card on the Packing tab. The label's bounds come
 * from `renameContainerSchema` (derived from the container schema); the
 * server re-checks them (`updateNative`'s `assertStrLen`).
 */
export function RenameCaseDialog({
  target,
  onClose,
  onSubmit,
}: {
  /** The case being renamed; `null` closes the dialog. */
  target: { id: string; label: string } | null;
  onClose: () => void;
  onSubmit: (id: string, label: string) => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        {target && <RenameCaseForm key={target.id} target={target} onClose={onClose} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameCaseForm({
  target,
  onClose,
  onSubmit,
}: {
  target: { id: string; label: string };
  onClose: () => void;
  onSubmit: (id: string, label: string) => void;
}) {
  const form = useForm<RenameContainerFormValues>({
    resolver: zodResolver(renameContainerSchema),
    defaultValues: { label: target.label },
  });
  const error = form.formState.errors.label?.message;

  return (
    <form
      onSubmit={form.handleSubmit(({ label }) => {
        const next = label.trim();
        if (!next) {
          form.setError("label", { message: "Label is required" });
          return;
        }
        if (next !== target.label) onSubmit(target.id, next);
        onClose();
      })}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Rename case</DialogTitle>
      </DialogHeader>
      <div className="space-y-1.5">
        <label htmlFor="rename-case-label" className="t-overline text-muted">
          Name
        </label>
        <Input
          id="rename-case-label"
          autoFocus
          aria-invalid={!!error}
          className="max-md:text-base"
          {...form.register("label")}
        />
        {error && <p role="alert" className="text-caption text-t-out">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Rename</Button>
      </DialogFooter>
    </form>
  );
}
