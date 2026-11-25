import { Download, ExternalLink, Pencil, Trash2 } from "lucide-react";

import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-category";
import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * A job file row's ⋯ and the Files bulk verbs (UX Phase 10, spec §8c): Open ·
 * Download · Rename… · Change category ▸ · Remove. Remove DELETES the stored file,
 * so it is a confirmed hard delete with NO Undo (an Undo never deletes or restores
 * stored bytes). A viewer gets only Open and Download (the write verbs are absent).
 */
export interface FileRowHandlers {
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onSetType: (type: FileCategory) => void;
  onRemove: () => void;
}

export function buildFileRowActions(file: { type: string; name: string }, canEdit: boolean, h: FileRowHandlers): ActionMenuSpec {
  const items: ActionItem[] = [
    { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: h.onOpen },
    { key: "download", label: "Download", group: "edit", icon: Download, onSelect: h.onDownload },
  ];
  if (!canEdit) return { items };
  items.push(
    { key: "rename", label: "Rename…", group: "edit", icon: Pencil, onSelect: h.onRename },
    {
      key: "category",
      label: "Change category",
      group: "organise",
      onSelect: () => {},
      children: FILE_CATEGORIES.filter((c) => c.value !== file.type).map((c) => ({
        key: `category-${c.value}`,
        label: c.label,
        group: "organise" as const,
        onSelect: () => h.onSetType(c.value),
      })),
    },
    {
      key: "remove",
      label: "Remove",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: h.onRemove,
      confirm: {
        title: `Remove “${file.name}”?`,
        body: "The file is deleted from this job and from storage. This cannot be undone.",
        confirmLabel: "Remove file",
      },
    },
  );
  return { items };
}

export interface FileBulkHandlers {
  onSetType: (type: FileCategory) => void;
  onDownload: () => void;
  onRemove: () => void;
}

/** `Category ▾ · Download · Remove`, every label carrying the count; Remove last, danger, confirmed. */
export function buildFileBulkActions(canEdit: boolean, h: FileBulkHandlers): BulkAction[] {
  const download: BulkAction = { key: "download", label: (n) => `Download ${n}`, group: "edit", icon: Download, onSelect: h.onDownload };
  if (!canEdit) return [download];
  return [
    {
      key: "category",
      label: (n) => `Category ${n}`,
      group: "organise",
      onSelect: () => {},
      children: FILE_CATEGORIES.map((c) => ({ key: `category-${c.value}`, label: () => c.label, group: "organise" as const, onSelect: () => h.onSetType(c.value) })),
    },
    download,
    {
      key: "remove",
      label: (n) => `Remove ${n}`,
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: h.onRemove,
      confirm: {
        title: "Remove these files?",
        body: "The files are deleted from this job and from storage. This cannot be undone.",
        confirmLabel: "Remove files",
      },
    },
  ];
}
