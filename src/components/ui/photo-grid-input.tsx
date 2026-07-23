"use client";

/**
 * Generic photo grid input used by damage capture, maintenance, and any
 * other "attach photos to this record" flow.
 *
 * Mobile-first: the input uses `capture="environment"` to bias toward the
 * rear camera on phones, falls back to file picker on desktop.
 *
 * Controlled-ish API: parent passes initial `value` (string[] of URLs).
 * On every change the component fires `onChange` with the new URL array.
 * Pending uploads are tracked internally; once they succeed they merge
 * into the value. If a photo fails, it stays visible in error state and
 * does NOT enter the value until the operator removes it.
 *
 * Submit-blocking: `onUploadingChange(true|false)` fires when any photo
 * is mid-upload, so parents can disable their submit button.
 */

import { useEffect, useRef, useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import { Camera, Loader2, X } from "lucide-react";

interface PendingPhoto {
  previewUrl: string;
  uploadedUrl: string | null;
  file: File;
  uploading: boolean;
  error?: string;
}

async function uploadOne(file: File): Promise<string> {
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

export interface PhotoGridInputProps {
  /** Already-uploaded URLs (e.g. from an existing record being edited). */
  value: string[];
  /** Fires whenever the URL list changes — including after a successful upload. */
  onChange: (urls: string[]) => void;
  /** Fires when ANY photo is uploading. Parents wire this to disable submit. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Max total photos (existing + pending). Defaults to 20. */
  maxPhotos?: number;
  /** Smaller layout density (4 cols vs 3). Useful inside narrow drawers. */
  compact?: boolean;
}

export function PhotoGridInput({
  value,
  onChange,
  onUploadingChange,
  maxPhotos = 20,
  compact = false,
}: PhotoGridInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);

  // Refs to the latest value + onChange so async upload completions can
  // see the up-to-date state without closure staleness.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Notify parent on every upload state change
  useEffect(() => {
    const anyUploading = pending.some((p) => p.uploading);
    onUploadingChange?.(anyUploading);
  }, [pending, onUploadingChange]);

  // Tidy up object URLs on unmount
  useEffect(() => {
    return () => {
      for (const p of pending) URL.revokeObjectURL(p.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const available = maxPhotos - (value.length + pending.length);
    const toAccept = files.slice(0, Math.max(0, available));

    const newEntries: PendingPhoto[] = toAccept.map((file) => ({
      previewUrl: URL.createObjectURL(file),
      uploadedUrl: null,
      file,
      uploading: true,
    }));
    setPending((prev) => [...prev, ...newEntries]);

    if (fileInputRef.current) fileInputRef.current.value = "";

    // Upload each in parallel. We deliberately commit URLs to the value
    // array one at a time as they land (instead of batching) so a
    // partially-failed upload still saves the ones that succeeded.
    await Promise.all(
      newEntries.map(async (entry) => {
        try {
          const url = await uploadOne(entry.file);
          setPending((prev) =>
            prev.map((p) =>
              p.previewUrl === entry.previewUrl
                ? { ...p, uploadedUrl: url, uploading: false }
                : p,
            ),
          );
          // Append this URL to value via the latest snapshot (avoids
          // closure-stale onChange overwriting concurrent uploads).
          const current = valueRef.current;
          if (!current.includes(url)) {
            const next = [...current, url];
            valueRef.current = next; // keep ref ahead so the next concurrent upload sees it
            onChangeRef.current(next);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setPending((prev) =>
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

  function removeExisting(url: string) {
    const next = valueRef.current.filter((u) => u !== url);
    valueRef.current = next;
    onChangeRef.current(next);
  }

  function removePending(previewUrl: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.previewUrl === previewUrl);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.uploadedUrl) {
          // Also remove from the value if it had been uploaded
          const next = valueRef.current.filter((u) => u !== target.uploadedUrl);
          valueRef.current = next;
          onChangeRef.current(next);
        }
      }
      return prev.filter((p) => p.previewUrl !== previewUrl);
    });
  }

  const totalCount = value.length + pending.length;
  const atCap = totalCount >= maxPhotos;
  const gridClass = compact ? "grid-cols-4 gap-1.5" : "grid-cols-3 gap-2";

  return (
    <div className={`grid ${gridClass}`}>
      {/* Existing uploaded photos */}
      {value.map((url) => (
        <div
          key={url}
          className="relative aspect-square overflow-hidden rounded-md border bg-bg-inset"
        >
          <AppImage src={url} alt="" fill sizes="(max-width: 768px) 50vw, 200px" className="object-cover" />
          <button
            type="button"
            onClick={() => removeExisting(url)}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
            aria-label="Remove photo"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      {/* Pending uploads / errors */}
      {pending
        .filter((p) => !p.uploadedUrl || !value.includes(p.uploadedUrl))
        .map((photo) => (
          <div
            key={photo.previewUrl}
            className="relative aspect-square overflow-hidden rounded-md border bg-bg-inset"
          >
            <AppImage
              src={photo.previewUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, 200px"
              className="object-cover"
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
              onClick={() => removePending(photo.previewUrl)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              aria-label="Remove photo"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

      {/* Add-photo tile (hidden when at cap) */}
      {!atCap && (
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-bg-inset/50 text-fg-3 transition-colors hover:bg-bg-inset hover:text-fg-2">
          <Camera className={compact ? "size-4" : "size-6"} />
          <span className={`mt-1 ${compact ? "text-[9px]" : "text-[11px]"}`}>
            Add photo
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleSelect}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}
