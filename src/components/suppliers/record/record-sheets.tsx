"use client";

import * as React from "react";

import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ORDER_FILE_KIND_LABELS, ORDER_FILE_KINDS, type OrderFileKind } from "../../../../convex/lib/supplierRecordCore";
import { fromDateInput, toDateInput } from "@/lib/date-input";
import { supplierContactSchema, supplierDocumentSchema, supplierOrderFileSchema, type SupplierContactFormValues, type SupplierDocumentFormValues } from "@/lib/validations/supplier-record";
import type { ContactValues, DocumentValues } from "./use-supplier-record-writes";

/**
 * The three small forms of UX Phase 13's B3, on the shared `FormSheet` shell (no shell of our
 * own). Each validates with its Zod schema before it submits; the server re-checks every bound.
 */
function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-caption text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

const trimmed = (s: string | undefined) => s?.trim() || undefined;

/**
 * The one submit shape of all three sheets: `prepare` validates and returns either an error
 * message or the save to run; a save that lands closes the sheet, one that fails (it already
 * toasted) leaves the draft in place.
 */
function useSheetSubmit(onOpenChange: (open: boolean) => void, prepare: () => string | (() => Promise<boolean>) | undefined) {
  const [error, setError] = React.useState<string | undefined>();
  const [saving, setSaving] = React.useState(false);
  async function submit() {
    const next = prepare();
    if (typeof next !== "function") return setError(next ?? "Check the form");
    setError(undefined);
    setSaving(true);
    const ok = await next();
    setSaving(false);
    if (ok) onOpenChange(false);
  }
  return { error, saving, submit };
}

const contactDefaults = (i: ContactValues = {}): SupplierContactFormValues => ({ name: i.name ?? "", role: i.role ?? "", email: i.email ?? "", phone: i.phone ?? "", notes: i.notes ?? "" });

// ─── Contact ──────────────────────────────────────────────────────────────────────────

export function ContactSheet({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  initial?: ContactValues;
  onSave: (v: ContactValues) => Promise<boolean>;
}) {
  const [v, setV] = React.useState<SupplierContactFormValues>(() => contactDefaults(initial));
  const set = (k: keyof SupplierContactFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const { error, saving, submit } = useSheetSubmit(onOpenChange, () => {
    const parsed = supplierContactSchema.safeParse(v);
    if (!parsed.success) return parsed.error.issues[0]?.message;
    return () => onSave({ name: trimmed(v.name), role: trimmed(v.role), email: trimmed(v.email), phone: trimmed(v.phone), notes: trimmed(v.notes) });
  });
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={initial ? "Edit contact" : "Add contact"} primaryLabel={initial ? "Save contact" : "Add contact"} onSubmit={submit} submitting={saving} dirty size="narrow">
      <Field id="sc-name" label="Name"><Input id="sc-name" value={v.name} onChange={set("name")} /></Field>
      <Field id="sc-role" label="Role"><Input id="sc-role" value={v.role} onChange={set("role")} /></Field>
      <Field id="sc-email" label="Email"><Input id="sc-email" type="email" value={v.email} onChange={set("email")} /></Field>
      <Field id="sc-phone" label="Phone"><Input id="sc-phone" type="tel" value={v.phone} onChange={set("phone")} /></Field>
      <Field id="sc-notes" label="Notes" error={error}><Textarea id="sc-notes" value={v.notes} onChange={set("notes")} rows={3} /></Field>
    </FormSheet>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────────────

const DOCUMENT_KIND_SUGGESTIONS = ["Insurance", "Contract", "Licence", "Safety certificate", "Terms"] as const;

type DocumentInitial = { name: string; kind: string | null; expiryDate: number | null; notes: string | null };
const documentDefaults = (i?: DocumentInitial): SupplierDocumentFormValues => ({ name: i?.name ?? "", kind: i?.kind ?? "", expiry: toDateInput(i?.expiryDate), notes: i?.notes ?? "" });

export function DocumentSheet({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing (the file itself is never replaced here). */
  initial?: DocumentInitial;
  onSave: (v: DocumentValues, file: File | null) => Promise<boolean>;
}) {
  const [v, setV] = React.useState<SupplierDocumentFormValues>(() => documentDefaults(initial));
  const [file, setFile] = React.useState<File | null>(null);
  const set = (k: keyof SupplierDocumentFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const { error, saving, submit } = useSheetSubmit(onOpenChange, () => {
    const parsed = supplierDocumentSchema.safeParse(v);
    if (!parsed.success) return parsed.error.issues[0]?.message;
    if (!initial && !file) return "Choose a file to upload";
    return () => onSave({ name: parsed.data.name, kind: trimmed(v.kind), expiryDate: v.expiry ? fromDateInput(v.expiry) : undefined, notes: trimmed(v.notes) }, file);
  });
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={initial ? "Edit document" : "Add document"} description={initial ? undefined : "Insurance, contracts, licences. Add an expiry date to be warned before it lapses."} primaryLabel={initial ? "Save document" : "Add document"} onSubmit={submit} submitting={saving} dirty size="narrow">
      {initial ? null : (
        <Field id="sd-file" label="File"><Input id="sd-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      )}
      <Field id="sd-name" label="Name"><Input id="sd-name" value={v.name} onChange={set("name")} /></Field>
      <Field id="sd-kind" label="Type">
        <Input id="sd-kind" list="sd-kinds" value={v.kind} onChange={set("kind")} placeholder="Insurance, Contract…" />
        <datalist id="sd-kinds">{DOCUMENT_KIND_SUGGESTIONS.map((k) => <option key={k} value={k} />)}</datalist>
      </Field>
      <Field id="sd-expiry" label="Expires"><Input id="sd-expiry" type="date" value={v.expiry} onChange={set("expiry")} /></Field>
      <Field id="sd-notes" label="Notes" error={error}><Textarea id="sd-notes" value={v.notes} onChange={set("notes")} rows={2} /></Field>
    </FormSheet>
  );
}

// ─── Order file ───────────────────────────────────────────────────────────────────────

export function OrderFileSheet({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File, kind: OrderFileKind, name?: string) => Promise<boolean>;
}) {
  const [kind, setKind] = React.useState<OrderFileKind>("PO");
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const { error, saving, submit } = useSheetSubmit(onOpenChange, () => {
    if (!file) return "Choose a file to upload";
    const parsed = supplierOrderFileSchema.safeParse({ kind, name });
    return parsed.success ? () => onSave(file, parsed.data.kind, trimmed(parsed.data.name)) : parsed.error.issues[0]?.message;
  });
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Attach a file" description="A purchase order, a delivery docket or anything else for this order. The invoice has its own slot." primaryLabel="Attach file" onSubmit={submit} submitting={saving} dirty size="narrow">
      <Field id="of-file" label="File"><Input id="of-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Field id="of-kind" label="Type">
        <Select value={kind} onValueChange={(k) => setKind(k as OrderFileKind)}>
          <SelectTrigger id="of-kind"><SelectValue>{ORDER_FILE_KIND_LABELS[kind]}</SelectValue></SelectTrigger>
          <SelectContent>{ORDER_FILE_KINDS.map((k) => <SelectItem key={k} value={k}>{ORDER_FILE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field id="of-name" label="Name (optional)" error={error}><Input id="of-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </FormSheet>
  );
}
