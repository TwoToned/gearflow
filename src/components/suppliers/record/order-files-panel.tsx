"use client";

import * as React from "react";
import { Download, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { RecordRows } from "@/components/people/record-shell";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { fileSizeLabel } from "@/lib/file-size";
import { ORDER_FILE_KIND_LABELS, type OrderFileKind } from "../../../../convex/lib/supplierRecordCore";
import { OrderFileSheet } from "./record-sheets";

export interface OrderFileRow {
  id: string;
  kind: OrderFileKind;
  name: string | null;
  file: { id: string; fileName: string; fileSize: number; mimeType: string; url: string } | null;
}

const labelOf = (f: OrderFileRow) => f.name || f.file?.fileName || "File";

/**
 * The order's PO / docket / other files (UX Phase 13, B3). The invoice keeps its own 1:1 slot,
 * shown under this list by the page. Removing a file deletes it for good (a confirmed red verb,
 * no Undo); attaching one has an Undo that detaches the row and leaves the uploaded file.
 */
export function OrderFilesPanel({
  files,
  canUpdate,
  onAdd,
  onRemove,
}: {
  files: OrderFileRow[];
  canUpdate: boolean;
  onAdd: (file: File, kind: OrderFileKind, name?: string) => Promise<boolean>;
  onRemove: (id: string, label: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = React.useState(false);
  const menu = (f: OrderFileRow): ActionMenuSpec => ({
    items: [
      ...(f.file ? [{ key: "open", label: "Open file", group: "organise" as const, icon: Download, onSelect: () => void window.open(f.file!.url, "_blank", "noopener") }] : []),
      { key: "remove", label: "Remove…", group: "danger", icon: Trash2, danger: true, onSelect: () => void onRemove(f.id, labelOf(f)), confirm: { title: `Remove ${labelOf(f)}?`, body: "This deletes the file for good. It cannot be undone.", confirmLabel: "Delete file" } },
    ],
  });
  return (
    <div>
      {canUpdate ? (
        <div className="mb-3 flex justify-end">
          <Button variant="line" size="sm" onClick={() => setAdding(true)}>Attach file</Button>
        </div>
      ) : null}
      <RecordRows
        noun="file"
        empty="No purchase order or docket attached yet."
        rows={files.map((f) => ({
          id: f.id,
          title: labelOf(f),
          href: f.file?.url,
          meta: [ORDER_FILE_KIND_LABELS[f.kind], f.file ? fileSizeLabel(f.file.fileSize) : null],
          trailing: canUpdate ? <ActionMenu spec={menu(f)} label={`${labelOf(f)} actions`} /> : undefined,
        }))}
      />
      {adding ? <OrderFileSheet open onOpenChange={(o) => !o && setAdding(false)} onSave={onAdd} /> : null}
    </div>
  );
}
