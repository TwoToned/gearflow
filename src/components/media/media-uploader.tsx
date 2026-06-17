"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Upload,
  X,
  Star,
  FileText,
  Loader2,
  ImageIcon,
} from "lucide-react";

import { MediaLightbox, useLightbox } from "@/components/media/media-lightbox";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useIsViewer } from "@/lib/use-permissions";

export interface MediaItem {
  id: string;
  fileId: string;
  type: string;
  isPrimary?: boolean;
  displayName?: string | null;
  sortOrder: number;
  file: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    url: string;
    thumbnailUrl?: string | null;
  };
}

interface MediaUploaderProps {
  entityType: "model" | "asset" | "kit" | "project" | "client" | "location" | "subHire";
  entityId: string;
  accept?: string;
  maxFiles?: number;
  existingMedia: MediaItem[];
  mediaType?: string;
  onUploadComplete: (fileUpload: { id: string }) => Promise<void>;
  onRemove: (mediaId: string) => Promise<void>;
  onSetPrimary?: (mediaId: string) => Promise<void>;
  onReorder?: (orderedIds: string[]) => Promise<void>;
  /** Called after any successful media change so the parent can refresh its own view. */
  onChanged?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaItemRow({
  item,
  onRemove,
  onSetPrimary,
  isRemoving,
  showPrimary,
  onImageClick,
}: {
  item: MediaItem;
  onRemove: (id: string) => void;
  onSetPrimary?: (id: string) => void;
  isRemoving: boolean;
  showPrimary: boolean;
  onImageClick?: () => void;
}) {
  const isImage = item.file.mimeType.startsWith("image/");

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border bg-bg-surface p-2">
      {isImage ? (
        <div
          className="h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-md bg-bg-inset"
          onClick={onImageClick}
        >
          <img
            src={item.file.thumbnailUrl || item.file.url}
            alt={item.displayName || item.file.fileName}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-bg-inset">
          <FileText className="h-6 w-6 text-fg-3" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {item.displayName || item.file.fileName}
        </p>
        <p className="text-xs text-fg-3">
          {formatFileSize(item.file.fileSize)}
        </p>
        {item.isPrimary && showPrimary && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <Star className="h-3 w-3 fill-current" /> Primary
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {showPrimary && !item.isPrimary && onSetPrimary && isImage && (
          <button
            onClick={() => onSetPrimary(item.id)}
            className="rounded p-1 text-fg-3 hover:bg-accent hover:text-fg"
            title="Set as primary"
          >
            <Star className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => onRemove(item.id)}
          disabled={isRemoving}
          className="rounded p-1 text-fg-3 hover:bg-destructive/10 hover:text-destructive"
          title="Remove"
        >
          {isRemoving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function MediaUploader({
  entityType,
  entityId,
  accept = "image/*",
  maxFiles,
  existingMedia,
  mediaType,
  onUploadComplete,
  onRemove,
  onSetPrimary,
  onChanged,
}: MediaUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const uploadMutation = useServerMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", entityType === "model" ? "models" : entityType === "asset" ? "assets" : entityType === "kit" ? "kits" : entityType === "client" ? "clients" : entityType === "location" ? "locations" : entityType === "subHire" ? "sub-hires" : "projects");
      formData.append("entityId", entityId);

      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      return res.json();
    },
    onSuccess: async (fileUpload) => {
      await onUploadComplete(fileUpload);
      onChanged?.();
      toast.success("File uploaded");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (maxFiles && existingMedia.length + fileArray.length > maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed`);
        return;
      }
      for (const file of fileArray) {
        uploadMutation.mutate(file);
      }
    },
    [uploadMutation, maxFiles, existingMedia.length]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleRemove = async (mediaId: string) => {
    setRemovingId(mediaId);
    try {
      await onRemove(mediaId);
      onChanged?.();
      toast.success("File removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setRemovingId(null);
    }
  };

  const handleSetPrimary = async (mediaId: string) => {
    if (!onSetPrimary) return;
    try {
      await onSetPrimary(mediaId);
      onChanged?.();
      toast.success("Primary photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const isViewer = useIsViewer();
  const showPrimary = accept.includes("image");
  const { lightboxState, openLightbox, closeLightbox } = useLightbox();

  const imageMedia = existingMedia.filter((m) => m.file.mimeType.startsWith("image/"));

  if (isViewer) {
    return (
      <div className="space-y-3">
        {existingMedia.length === 0 && (
          <p className="text-sm text-fg-3">No files.</p>
        )}
        {existingMedia.map((item) => {
          const isImage = item.file.mimeType.startsWith("image/");
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border bg-bg-surface p-2"
            >
              {isImage ? (
                <div
                  className="h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-md bg-bg-inset"
                  onClick={() => {
                    const idx = imageMedia.findIndex((m) => m.id === item.id);
                    openLightbox(
                      imageMedia.map((m) => ({ url: m.file.url, alt: m.displayName || m.file.fileName })),
                      idx >= 0 ? idx : 0,
                    );
                  }}
                >
                  <img
                    src={item.file.thumbnailUrl || item.file.url}
                    alt={item.displayName || item.file.fileName}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-bg-inset">
                  <FileText className="h-6 w-6 text-fg-3" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.displayName || item.file.fileName}
                </p>
                <p className="text-xs text-fg-3">
                  {formatFileSize(item.file.fileSize)}
                </p>
                {item.isPrimary && showPrimary && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                    <Star className="h-3 w-3 fill-current" /> Primary
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <MediaLightbox
          images={lightboxState.images}
          initialIndex={lightboxState.index}
          open={lightboxState.open}
          onClose={closeLightbox}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
          isDraggingOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        }`}
      >
        {uploadMutation.isPending ? (
          <Loader2 className="h-8 w-8 animate-spin text-fg-3" />
        ) : (
          <>
            {accept.includes("image") ? (
              <ImageIcon className="h-8 w-8 text-fg-3" />
            ) : (
              <Upload className="h-8 w-8 text-fg-3" />
            )}
          </>
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploadMutation.isPending
              ? "Uploading..."
              : "Drop files here or click to browse"}
          </p>
          <p className="text-xs text-fg-3">
            {accept === "image/*"
              ? "JPEG, PNG, WebP, GIF"
              : accept.includes(".pdf")
                ? "PDF, Word documents"
                : "All supported file types"}
            {maxFiles && ` — max ${maxFiles} files`}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Media list */}
      {existingMedia.length > 0 && (
        <div className="space-y-2">
          {existingMedia.map((item) => (
            <MediaItemRow
              key={item.id}
              item={item}
              onRemove={handleRemove}
              onSetPrimary={showPrimary ? handleSetPrimary : undefined}
              isRemoving={removingId === item.id}
              showPrimary={showPrimary}
              onImageClick={
                item.file.mimeType.startsWith("image/")
                  ? () => {
                      const idx = imageMedia.findIndex((m) => m.id === item.id);
                      openLightbox(
                        imageMedia.map((m) => ({ url: m.file.url, alt: m.displayName || m.file.fileName })),
                        idx >= 0 ? idx : 0,
                      );
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <MediaLightbox
        images={lightboxState.images}
        initialIndex={lightboxState.index}
        open={lightboxState.open}
        onClose={closeLightbox}
      />
    </div>
  );
}
