"use client";

import * as React from "react";
import { Download, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecordRows, type HealthItem } from "@/components/people/record-shell";
import type { ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { fileSizeLabel } from "@/lib/file-size";
import { fromDateInput, toDateInput } from "@/lib/date-input";
import { dayLabel } from "@/lib/list-views/people";
import { crewDocumentSchema } from "@/lib/validations/crew-document";
import {
  CREW_DOCUMENT_KIND_LABELS,
  CREW_DOCUMENT_KINDS,
  crewDocumentExpiry,
  worstCrewDocument,
  type CrewDocumentKind,
} from "../../../../convex/lib/crewDocumentCore";
import type { CrewDocumentValues } from "./use-crew-document-writes";

/** A crew member's `Documents` tab (UX Phase 13, D72). Present only when the server returned the list (the visibility rule). */
export interface CrewDocumentRow {
  id: string;
  kind: CrewDocumentKind;
  name: string;
  expiresAt: number | null;
  file: { fileName: string; fileSize: number; mimeType: string; downloadPath: string } | null;
}

const DAY_MS = 86_400_000;

/** A document's expiry as a status word, derived on read. */
function expiryStatus(expiresAt: number | null, now: number): StatusValue | undefined {
  const e = crewDocumentExpiry(expiresAt, now);
  if (e.state === "expired") return { label: "Expired", intent: "error" };
  if (e.state === "soon") return { label: e.days === 0 ? "Expires today" : `Expires in ${e.days}d`, intent: "warning" };
  return undefined;
}

/** The Overview health row: the WORST document only, as `White card expired 21 Nov` (kind and date; never the file). */
export function crewDocumentHealthItem(docs: { kind: CrewDocumentKind; expiresAt: number | null }[], now: number, open: () => void): HealthItem | null {
  const worst = worstCrewDocument(docs, now);
  if (!worst || worst.doc.expiresAt == null) return null;
  const date = dayLabel(Math.floor(worst.doc.expiresAt / DAY_MS));
  const text = worst.state === "expired" ? `${CREW_DOCUMENT_KIND_LABELS[worst.doc.kind]} expired ${date}` : `${CREW_DOCUMENT_KIND_LABELS[worst.doc.kind]} expires in ${worst.days}d`;
  return { key: "documents", tone: worst.state === "expired" ? "error" : "warning", text, action: { label: "Documents", onSelect: open } };
}

type SheetInitial = { kind: CrewDocumentKind; name: string; expiresAt: number | null };

const sheetDefaults = (i?: SheetInitial) => ({ kind: i ? i.kind : ("LICENCE" as CrewDocumentKind), name: i ? i.name : "", expiry: i ? toDateInput(i.expiresAt) : "" });

function DocumentSheet({ onOpenChange, initial, onSave }: { onOpenChange: (open: boolean) => void; initial?: SheetInitial; onSave: (v: CrewDocumentValues, file: File | null) => Promise<boolean> }) {
  const start = sheetDefaults(initial);
  const [kind, setKind] = React.useState<CrewDocumentKind>(start.kind);
  const [name, setName] = React.useState(start.name);
  const [expiry, setExpiry] = React.useState(start.expiry);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | undefined>();
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    const parsed = crewDocumentSchema.safeParse({ kind, name, expiry });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    if (!initial && !file) return setError("Choose a file to upload");
    setError(undefined);
    setSaving(true);
    const ok = await onSave({ kind: parsed.data.kind, name: parsed.data.name?.trim() || undefined, expiresAt: parsed.data.expiry ? fromDateInput(parsed.data.expiry) : undefined }, file);
    setSaving(false);
    if (ok) onOpenChange(false);
  }
  return (
    <FormSheet open onOpenChange={onOpenChange} title={initial ? "Edit document" : "Add document"} description={initial ? undefined : "A PDF or an image. Only this person and crew managers can open it."} primaryLabel={initial ? "Save document" : "Add document"} onSubmit={submit} submitting={saving} dirty size="narrow">
      {initial ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="cd-file">File</Label>
          <Input id="cd-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="cd-kind">Type</Label>
        <Select value={kind} onValueChange={(k) => setKind(k as CrewDocumentKind)}>
          <SelectTrigger id="cd-kind"><SelectValue>{CREW_DOCUMENT_KIND_LABELS[kind]}</SelectValue></SelectTrigger>
          <SelectContent>{CREW_DOCUMENT_KINDS.map((k) => <SelectItem key={k} value={k}>{CREW_DOCUMENT_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cd-name">Name (optional)</Label>
        <Input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="White card, EWP ticket…" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cd-expiry">Expires</Label>
        <Input id="cd-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

export function CrewDocumentsTab({
  documents,
  now,
  canWrite,
  onAdd,
  onEdit,
  onRemove,
}: {
  documents: CrewDocumentRow[];
  now: number;
  /** `crew:update`: the member themself may read but never writes. */
  canWrite: boolean;
  onAdd: (v: CrewDocumentValues, file: File) => Promise<boolean>;
  onEdit: (id: string, v: CrewDocumentValues) => Promise<boolean>;
  onRemove: (id: string, label: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<CrewDocumentRow | null>(null);
  const menu = (d: CrewDocumentRow): ActionMenuSpec => ({
    items: [
      ...(d.file ? [{ key: "open", label: "Open file", group: "organise" as const, icon: Download, onSelect: () => void window.open(d.file!.downloadPath, "_blank", "noopener") }] : []),
      ...(canWrite
        ? [
            { key: "edit", label: "Edit…", group: "organise" as const, icon: Pencil, kbd: "E", onSelect: () => setEditing(d) },
            { key: "remove", label: "Remove…", group: "danger" as const, icon: Trash2, danger: true, onSelect: () => void onRemove(d.id, d.name), confirm: { title: `Remove ${d.name}?`, body: "This deletes the document and its file for good. It cannot be undone.", confirmLabel: "Delete document" } },
          ]
        : []),
    ],
  });
  return (
    <div>
      {canWrite ? (
        <div className="mb-3 flex justify-end">
          <Button variant="line" size="sm" onClick={() => setAdding(true)}>Add document</Button>
        </div>
      ) : null}
      <RecordRows
        noun="document"
        empty="No documents yet. Keep licences, tickets and insurance here, with an expiry date."
        rows={documents.map((d) => ({
          id: d.id,
          title: d.name,
          meta: [CREW_DOCUMENT_KIND_LABELS[d.kind], d.expiresAt != null ? `expires ${dayLabel(Math.floor(d.expiresAt / DAY_MS))}` : null, d.file ? fileSizeLabel(d.file.fileSize) : null],
          status: expiryStatus(d.expiresAt, now),
          trailing: <ActionMenu spec={menu(d)} label={`${d.name} actions`} />,
        }))}
      />
      {adding ? <DocumentSheet onOpenChange={(o) => !o && setAdding(false)} onSave={(v, file) => (file ? onAdd(v, file) : Promise.resolve(false))} /> : null}
      {editing ? <DocumentSheet onOpenChange={(o) => !o && setEditing(null)} initial={{ kind: editing.kind, name: editing.name, expiresAt: editing.expiresAt }} onSave={(v) => onEdit(editing.id, v)} /> : null}
    </div>
  );
}
