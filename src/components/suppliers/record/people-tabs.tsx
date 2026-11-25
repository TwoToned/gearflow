"use client";

import * as React from "react";
import { Download, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { RecordRows, type HealthItem } from "@/components/people/record-shell";
import type { ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { fileSizeLabel } from "@/lib/file-size";
import { dayLabel } from "@/lib/list-views/people";
import { documentExpiry } from "../../../../convex/lib/supplierRecordCore";
import { ContactSheet, DocumentSheet } from "./record-sheets";
import type { ContactValues, DocumentValues } from "./use-supplier-record-writes";

/** The supplier record's `Contacts` and `Documents` tabs (UX Phase 13, B3). */
export interface ContactRow { id: string; name: string | null; role: string | null; email: string | null; phone: string | null; notes: string | null }
export interface DocumentRow {
  id: string;
  name: string;
  kind: string | null;
  expiryDate: number | null;
  notes: string | null;
  file: { id: string; fileName: string; fileSize: number; mimeType: string; url: string } | null;
}

const DAY_MS = 86_400_000;
const contactLabel = (c: ContactRow) => c.name || c.email || c.phone || "contact";

function AddBar({ label, onAdd }: { label: string; onAdd?: () => void }) {
  if (!onAdd) return null;
  return (
    <div className="mb-3 flex justify-end">
      <Button variant="line" size="sm" onClick={onAdd}>{label}</Button>
    </div>
  );
}

// ─── Contacts ──────────────────────────────────────────────────────────────────────────

export function ContactsTab({
  contacts,
  canUpdate,
  onAdd,
  onEdit,
  onRemove,
}: {
  contacts: ContactRow[];
  canUpdate: boolean;
  onAdd: (v: ContactValues) => Promise<boolean>;
  onEdit: (id: string, v: ContactValues) => Promise<boolean>;
  onRemove: (id: string, label: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<ContactRow | null>(null);
  const menu = (c: ContactRow): ActionMenuSpec => ({
    items: [
      { key: "edit", label: "Edit…", group: "organise", icon: Pencil, kbd: "E", onSelect: () => setEditing(c) },
      { key: "remove", label: "Remove…", group: "danger", icon: Trash2, danger: true, onSelect: () => void onRemove(c.id, contactLabel(c)), confirm: { title: `Remove ${contactLabel(c)}?`, body: "The contact is removed from this supplier. You can undo it for a few minutes.", confirmLabel: "Remove contact" } },
    ],
  });
  return (
    <div>
      <AddBar label="Add contact" onAdd={canUpdate ? () => setAdding(true) : undefined} />
      <RecordRows
        noun="contact"
        empty="No other contacts yet. The supplier's main contact is on Overview."
        rows={contacts.map((c) => ({
          id: c.id,
          title: contactLabel(c),
          meta: [c.role, c.email, c.phone],
          trailing: canUpdate ? <ActionMenu spec={menu(c)} label={`${contactLabel(c)} actions`} /> : undefined,
        }))}
      />
      {adding ? <ContactSheet open onOpenChange={(o) => !o && setAdding(false)} onSave={onAdd} /> : null}
      {editing ? (
        <ContactSheet open onOpenChange={(o) => !o && setEditing(null)} initial={{ name: editing.name ?? "", role: editing.role ?? "", email: editing.email ?? "", phone: editing.phone ?? "", notes: editing.notes ?? "" }} onSave={(v) => onEdit(editing.id, v)} />
      ) : null}
    </div>
  );
}

// ─── Documents ─────────────────────────────────────────────────────────────────────────

/** A document's expiry as a status word (derived on read, never stored). */
function expiryStatus(d: { expiryDate: number | null }, now: number): StatusValue | undefined {
  const e = documentExpiry(d.expiryDate, now);
  if (e.state === "expired") return { label: "Expired", intent: "error" };
  if (e.state === "soon") return { label: e.days === 0 ? "Expires today" : `Expires in ${e.days}d`, intent: "warning" };
  return undefined;
}

/** Overview health rows: an expired or soon-to-expire document, each with its muted `Documents ›` action. */
export function documentHealthItems(docs: DocumentRow[], now: number, open: () => void): HealthItem[] {
  return docs.flatMap((d) => {
    const s = expiryStatus(d, now);
    if (!s) return [];
    return [{ key: `doc-${d.id}`, tone: s.intent === "error" ? ("error" as const) : ("warning" as const), text: `${d.name} ${s.label.toLowerCase()}`, action: { label: "Documents", onSelect: open } }];
  });
}

export function DocumentsTab({
  documents,
  now,
  canUpdate,
  onAdd,
  onEdit,
  onRemove,
}: {
  documents: DocumentRow[];
  now: number;
  canUpdate: boolean;
  onAdd: (v: DocumentValues, file: File) => Promise<boolean>;
  onEdit: (id: string, v: DocumentValues) => Promise<boolean>;
  onRemove: (id: string, name: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<DocumentRow | null>(null);
  const menu = (d: DocumentRow): ActionMenuSpec => ({
    items: [
      ...(d.file ? [{ key: "open", label: "Open file", group: "organise" as const, icon: Download, onSelect: () => void window.open(d.file!.url, "_blank", "noopener") }] : []),
      { key: "edit", label: "Edit…", group: "organise", icon: Pencil, kbd: "E", onSelect: () => setEditing(d) },
      { key: "remove", label: "Remove…", group: "danger", icon: Trash2, danger: true, onSelect: () => void onRemove(d.id, d.name), confirm: { title: `Remove ${d.name}?`, body: "This deletes the document and its file for good. It cannot be undone.", confirmLabel: "Delete document" } },
    ],
  });
  return (
    <div>
      <AddBar label="Add document" onAdd={canUpdate ? () => setAdding(true) : undefined} />
      <RecordRows
        noun="document"
        empty="No documents yet. Keep insurance and contracts here, with an expiry date."
        rows={documents.map((d) => ({
          id: d.id,
          title: d.name,
          href: d.file?.url,
          meta: [d.kind, d.expiryDate != null ? `expires ${dayLabel(Math.floor(d.expiryDate / DAY_MS))}` : null, d.file ? fileSizeLabel(d.file.fileSize) : null],
          status: expiryStatus(d, now),
          trailing: canUpdate ? <ActionMenu spec={menu(d)} label={`${d.name} actions`} /> : undefined,
        }))}
      />
      {adding ? <DocumentSheet open onOpenChange={(o) => !o && setAdding(false)} onSave={(v, file) => (file ? onAdd(v, file) : Promise.resolve(false))} /> : null}
      {editing ? (
        <DocumentSheet open onOpenChange={(o) => !o && setEditing(null)} initial={{ name: editing.name, kind: editing.kind, expiryDate: editing.expiryDate, notes: editing.notes }} onSave={(v) => onEdit(editing.id, v)} />
      ) : null}
    </div>
  );
}
