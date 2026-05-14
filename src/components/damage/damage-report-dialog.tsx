"use client";

/**
 * Damage report dialog — mobile-first capture flow for the return tab
 * and any future entry point. Camera-first photo input (uses Safari's
 * `capture="environment"` to bias toward the rear camera), severity
 * radio with descriptive captions, required notes textarea, optional
 * estimated cost, and a "charge back to client" toggle.
 *
 * On submit:
 *   1. Upload each pending photo to /api/uploads → collect URLs
 *   2. Call createDamageEvent with severity / notes / photos / costs
 *   3. Toast structured success, invalidate the P&L query so the panel
 *      refreshes immediately
 */

import { useState, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, X } from "lucide-react";

import { createDamageEvent } from "@/server/damage";
import { damageEventCreateSchema, type DamageEventCreateInput } from "@/lib/validations/damage";
import { showError } from "@/lib/show-error";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const SEVERITY_OPTIONS: Array<{
  value: "MINOR" | "MAJOR" | "TOTAL";
  label: string;
  desc: string;
  color: string;
}> = [
  {
    value: "MINOR",
    label: "Minor",
    desc: "Cosmetic. Item still works. No repair urgency.",
    color: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    value: "MAJOR",
    label: "Major",
    desc: "Needs repair before next deploy. Hold the asset.",
    color: "border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    value: "TOTAL",
    label: "Total",
    desc: "Beyond repair / write-off candidate.",
    color: "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300",
  },
];

interface DamageReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What got damaged. At least one of these must be set. */
  assetId?: string | null;
  bulkAssetId?: string | null;
  lineItemId?: string | null;
  /** Project context for activity log + P&L roll-up. */
  projectId?: string | null;
  /** Short label shown in the dialog header (e.g. "Shure SM58 — TTP0042"). */
  itemLabel?: string;
  onCreated?: () => void;
}

interface PendingPhoto {
  /** Browser-side preview URL (created via URL.createObjectURL). */
  previewUrl: string;
  /** Will be set after upload completes. */
  uploadedUrl: string | null;
  file: File;
  uploading: boolean;
  error?: string;
}

async function uploadPhoto(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }
  const json = (await res.json()) as { url: string };
  return json.url;
}

export function DamageReportDialog({
  open,
  onOpenChange,
  assetId,
  bulkAssetId,
  lineItemId,
  projectId,
  itemLabel,
  onCreated,
}: DamageReportDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  const form = useForm<DamageEventCreateInput>({
    resolver: zodResolver(damageEventCreateSchema),
    defaultValues: {
      severity: "MAJOR",
      notes: "",
      photos: [],
      estimatedCost: null,
      actualCost: null,
      chargedBack: false,
      createMaintenanceRecord: true,
      assetId: assetId ?? null,
      bulkAssetId: bulkAssetId ?? null,
      lineItemId: lineItemId ?? null,
      projectId: projectId ?? null,
    },
  });

  const mutation = useMutation({
    mutationFn: createDamageEvent,
    onSuccess: () => {
      toast.success("Damage reported", {
        description: form.watch("createMaintenanceRecord") && form.watch("severity") !== "MINOR"
          ? "A workshop ticket was created and the asset is on hold."
          : "Logged on the project's operational P&L.",
      });
      // Refresh anything that reads damage data.
      queryClient.invalidateQueries({ queryKey: ["project-operational-costs"] });
      queryClient.invalidateQueries({ queryKey: ["damage-events"] });
      queryClient.invalidateQueries({ queryKey: ["entity-activity"] });
      onCreated?.();
      onOpenChange(false);
      form.reset();
      setPhotos([]);
    },
    onError: (e) => showError(e, { fallbackTitle: "Could not report damage" }),
  });

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    // Show previews immediately; upload in parallel
    const newEntries: PendingPhoto[] = files.map((file) => ({
      previewUrl: URL.createObjectURL(file),
      uploadedUrl: null,
      file,
      uploading: true,
    }));
    setPhotos((prev) => [...prev, ...newEntries]);

    // Reset the input so the same file can be reselected
    if (fileInputRef.current) fileInputRef.current.value = "";

    await Promise.all(
      newEntries.map(async (entry) => {
        try {
          const url = await uploadPhoto(entry.file);
          setPhotos((prev) =>
            prev.map((p) =>
              p.previewUrl === entry.previewUrl
                ? { ...p, uploadedUrl: url, uploading: false }
                : p,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setPhotos((prev) =>
            prev.map((p) =>
              p.previewUrl === entry.previewUrl
                ? { ...p, uploading: false, error: message }
                : p,
            ),
          );
        }
      }),
    );
  }

  function removePhoto(previewUrl: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.previewUrl === previewUrl);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.previewUrl !== previewUrl);
    });
  }

  function onSubmit(data: DamageEventCreateInput) {
    // Block submit if any photo is mid-upload or failed.
    const uploading = photos.some((p) => p.uploading);
    if (uploading) {
      toast.error("Waiting on photo upload", {
        description: "Hold on a sec — one or more photos are still uploading.",
      });
      return;
    }
    const failed = photos.filter((p) => p.error);
    if (failed.length > 0) {
      toast.error(`${failed.length} photo${failed.length === 1 ? "" : "s"} failed to upload`, {
        description: "Remove or retry before submitting.",
      });
      return;
    }
    const uploaded = photos
      .map((p) => p.uploadedUrl)
      .filter((u): u is string => u != null);
    mutation.mutate({ ...data, photos: uploaded });
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Tidy up object URLs
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      form.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report damage</DialogTitle>
          <DialogDescription>
            {itemLabel
              ? `${itemLabel} — capture what happened so the workshop has context.`
              : "Capture what happened so the workshop has context."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {/* Severity radio cards */}
          <div className="space-y-2">
            <Label>Severity</Label>
            <Controller
              control={form.control}
              name="severity"
              render={({ field }) => (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {SEVERITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => field.onChange(opt.value)}
                      className={cn(
                        "rounded-md border-2 px-3 py-2 text-left transition-colors",
                        field.value === opt.value
                          ? opt.color
                          : "border-border bg-bg-surface hover:bg-bg-inset",
                      )}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-fg-3">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="damage-notes">What happened? *</Label>
            <Textarea
              id="damage-notes"
              {...form.register("notes")}
              placeholder="e.g. Driver dropped during load-out — left rear corner crushed, cone tear visible."
              rows={3}
              autoFocus
            />
            {form.formState.errors.notes && (
              <p className="text-xs text-destructive">{form.formState.errors.notes.message}</p>
            )}
          </div>

          {/* Photos — camera input on mobile, file picker on desktop */}
          <div className="space-y-2">
            <Label>Photos</Label>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <div
                  key={photo.previewUrl}
                  className="relative aspect-square overflow-hidden rounded-md border bg-bg-inset"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {photo.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  )}
                  {photo.error && (
                    <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[10px] text-destructive-foreground">
                      Failed
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.previewUrl)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="Remove photo"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {/* Add-photo tile */}
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-bg-inset/50 text-fg-3 transition-colors hover:bg-bg-inset hover:text-fg-2">
                <Camera className="size-6" />
                <span className="mt-1 text-[11px]">Add photo</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-[11px] text-fg-4">
              On phone, this opens the rear camera. Up to 20 photos.
            </p>
          </div>

          {/* Costs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="damage-est">Estimated cost (optional)</Label>
              <Input
                id="damage-est"
                type="number"
                step="0.01"
                min="0"
                {...form.register("estimatedCost", {
                  setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                })}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="damage-actual">Actual cost (optional)</Label>
              <Input
                id="damage-actual"
                type="number"
                step="0.01"
                min="0"
                {...form.register("actualCost", {
                  setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                })}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 rounded-md border bg-bg-inset/30 px-3 py-2.5">
            <Controller
              control={form.control}
              name="createMaintenanceRecord"
              render={({ field }) => (
                <label className="flex items-start gap-2.5">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                  <div>
                    <div className="text-sm">Create workshop ticket + hold asset</div>
                    <div className="text-[11px] text-fg-4">
                      Marks the asset IN_MAINTENANCE until repaired. Off only if you're just logging a cosmetic note.
                    </div>
                  </div>
                </label>
              )}
            />
            <Controller
              control={form.control}
              name="chargedBack"
              render={({ field }) => (
                <label className="flex items-start gap-2.5">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                  <div>
                    <div className="text-sm">Charging back to client</div>
                    <div className="text-[11px] text-fg-4">
                      Subtracts from project P&L. Remember to add the line in Xero — we don't push automatically.
                    </div>
                  </div>
                </label>
              )}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Report damage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
