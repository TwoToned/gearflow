"use client";

import * as React from "react";
import { FileText } from "lucide-react";

import { AppImage } from "@/components/ui/app-image";
import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/formatters";
import { FILE_CATEGORIES, fileCategoryLabel, fileSizeLabel, isPhotoFile, type FileCategory } from "@/lib/file-category";
import { buildFileRowActions } from "@/lib/row-actions/file-row";
import { cn, focusRing } from "@/lib/utils";

/** A job file as `projectFiles.listForProject` returns it. */
export interface JobFile {
  id: string;
  fileId: string;
  type: string;
  displayName: string | null;
  addedAt: number | null;
  uploadedByName: string | null;
  file: { id: string; fileName: string; fileSize: number; mimeType: string; url: string; thumbnailUrl: string | null };
}

export const fileName = (f: JobFile) => f.displayName ?? f.file.fileName;

/** Start a download of a stored file (an anchor with `download`; the URL is the stored bytes). */
export function downloadFile(f: JobFile) {
  const a = document.createElement("a");
  a.href = f.file.url;
  a.download = f.file.fileName;
  a.rel = "noopener";
  a.click();
}

/**
 * One file row (UX Phase 10, spec §8c): an always-on checkbox, thumbnail or type
 * badge, name (opens the file), the category as a menu, size, who uploaded it and
 * when, and ⋯ (Open · Download · Rename · Change category · Remove).
 */
export function FileRow({
  file,
  canEdit,
  selected,
  onSelectedChange,
  onRename,
  onSetType,
  onRemove,
}: {
  file: JobFile;
  canEdit: boolean;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  onRename: () => void;
  onSetType: (type: FileCategory) => void;
  onRemove: () => void;
}) {
  const name = fileName(file);
  const photo = isPhotoFile(file.file.mimeType);
  const spec = buildFileRowActions({ type: file.type, name }, canEdit, {
    onOpen: () => window.open(file.file.url, "_blank", "noopener"),
    onDownload: () => downloadFile(file),
    onRename,
    onSetType,
    onRemove,
  });
  const meta = [fileSizeLabel(file.file.fileSize), file.uploadedByName ? `by ${file.uploadedByName}` : null, file.addedAt ? formatDate(new Date(file.addedAt)) : null]
    .filter(Boolean)
    .join(" · ");
  const categoryItems = FILE_CATEGORIES.map((c) => ({ key: c.value, label: c.label, group: "edit" as const, onSelect: () => onSetType(c.value) }));

  return (
    <li className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
      <Checkbox checked={selected} onCheckedChange={(c) => onSelectedChange(c === true)} aria-label={`Select ${name}`} />
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--r)] bg-paper-2 text-muted">
        {photo ? <AppImage src={file.file.thumbnailUrl ?? file.file.url} alt="" width={40} height={40} className="size-10 object-cover" /> : <FileText className="size-5" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <a href={file.file.url} target="_blank" rel="noopener noreferrer" className={cn("block truncate text-ui-text text-ink hover:underline", focusRing)}>
          {name}
        </a>
        <div className="flex flex-wrap items-center gap-x-2 text-caption text-muted">
          {canEdit ? (
            <ActionMenu
              spec={{ items: categoryItems }}
              label={`Category of ${name}`}
              trigger={
                <button type="button" className={cn("rounded-sm text-muted hover:text-ink hover:underline", focusRing)} aria-label={`Category: ${fileCategoryLabel(file.type)}`}>
                  {fileCategoryLabel(file.type)}
                </button>
              }
            />
          ) : (
            <span>{fileCategoryLabel(file.type)}</span>
          )}
          <span>{meta}</span>
        </div>
      </div>
      <ActionMenu spec={spec} label={`${name} actions`} />
    </li>
  );
}
