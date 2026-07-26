"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Pencil, Star, Mail, Phone, Users } from "lucide-react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useClientContactWrites } from "@/hooks/use-client-contact-writes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, focusRing } from "@/lib/utils";
import type { ClientContactFormValues } from "@/lib/validations/client-contact";

export interface ClientContactRow {
  id: string;
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isPrimary?: boolean | null;
}

interface Props {
  clientId: string;
  contacts: ClientContactRow[];
  /** Called after an add/update/remove/setPrimary so the parent detail page refetches. */
  onChanged?: () => void;
}

const emptyDraft: ClientContactFormValues = { name: "", role: "", email: "", phone: "", notes: "" };

/** Add/edit dialog — shared shape for both flows, `contact` null means "add new". */
function ContactDialog({
  contact,
  onClose,
  onSave,
  saving,
}: {
  contact: ClientContactRow | null;
  onClose: () => void;
  onSave: (values: ClientContactFormValues) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<ClientContactFormValues>(
    contact
      ? { name: contact.name ?? "", role: contact.role ?? "", email: contact.email ?? "", phone: contact.phone ?? "", notes: contact.notes ?? "" }
      : emptyDraft,
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="cc-name">Name</Label>
            <Input id="cc-name" value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Contact person" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc-role">Role</Label>
            <Input id="cc-role" value={draft.role ?? ""} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} placeholder="e.g. Ops Manager" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cc-email">Email</Label>
              <Input id="cc-email" type="email" value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="email@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-phone">Phone</Label>
              <Input id="cc-phone" value={draft.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="+61 400 000 000" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc-notes">Notes</Label>
            <Textarea id="cc-notes" value={draft.notes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Any additional notes" rows={2} />
          </div>
          {!draft.name && !draft.email && !draft.phone && (
            <p className="text-caption text-muted">Provide at least a name, email, or phone number.</p>
          )}
          <DialogFooter>
            <Button
              loading={saving}
              disabled={!draft.name && !draft.email && !draft.phone}
              onClick={() => onSave(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read-only contacts list — the `CanDo` fallback for viewers without
 * `client:update` (mirrors how ModelAccessoriesManager is gated on the model
 * detail page). Falls back to the legacy embedded fields when the client has no
 * contact rows yet (pre-backfill / never-had-a-contact clients).
 */
export function ReadOnlyContactsList({
  contacts,
  legacy,
}: {
  contacts: ClientContactRow[];
  legacy: { contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null };
}) {
  if (contacts.length === 0) {
    if (!legacy.contactName && !legacy.contactEmail && !legacy.contactPhone) {
      return <p className="text-table-cell text-muted">No contacts yet</p>;
    }
    return (
      <div className="space-y-2 text-table-cell">
        {legacy.contactName && <p className="font-medium text-ink">{legacy.contactName}</p>}
        {legacy.contactEmail && (
          <div className="flex items-center gap-2 text-muted">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <a href={`mailto:${legacy.contactEmail}`} className={cn("truncate rounded-sm text-link hover:underline", focusRing)}>{legacy.contactEmail}</a>
          </div>
        )}
        {legacy.contactPhone && (
          <div className="flex items-center gap-2 text-muted">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <a href={`tel:${legacy.contactPhone}`} className={cn("rounded-sm text-link hover:underline", focusRing)}>{legacy.contactPhone}</a>
          </div>
        )}
      </div>
    );
  }
  return (
    <ul className="space-y-2 text-table-cell">
      {contacts.map((c) => (
        <li key={c.id}>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-ink">{c.name || c.email || c.phone}</span>
            {c.isPrimary && <span className="rounded-full bg-red-soft px-2 py-0.5 text-[11px] font-semibold text-ink">Primary</span>}
          </div>
          {c.email && <p className="text-muted">{c.email}</p>}
          {c.phone && <p className="text-muted">{c.phone}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Client contacts manager — replaces the client detail sidebar's single-contact
 * "Contact" section (WS9 #948). Shape mirrors `model-accessories-manager.tsx`: an
 * inline list + add/edit dialogs, refetch-via-onChanged (no optimistic cache
 * patching — parity with the accessories manager's pattern).
 */
export function ClientContactsManager({ clientId, contacts, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientContactRow | null>(null);
  const [duplicateEmailWarning, setDuplicateEmailWarning] = useState<string | null>(null);

  const writes = useClientContactWrites();
  const refresh = () => onChanged?.();
  const hasAny = contacts.length > 0;

  const checkDuplicateEmail = (email: string | undefined, excludeId?: string): void => {
    if (!email) return setDuplicateEmailWarning(null);
    const dup = contacts.some((c) => c.id !== excludeId && c.email && c.email.toLowerCase() === email.toLowerCase());
    setDuplicateEmailWarning(dup ? `Another contact on this client already uses ${email}.` : null);
  };

  const add = useServerMutation({
    mutationFn: (values: ClientContactFormValues) => writes.add(clientId, values),
    onSuccess: () => {
      toast.success("Contact added");
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = useServerMutation({
    mutationFn: (values: ClientContactFormValues) => {
      if (!editing) throw new Error("Nothing to edit");
      return writes.update(clientId, editing.id, values);
    },
    onSuccess: () => {
      toast.success("Contact updated");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useServerMutation({
    mutationFn: (contactId: string) => writes.remove(clientId, contactId),
    onSuccess: () => {
      toast.success("Contact removed");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const setPrimary = useServerMutation({
    mutationFn: (contactId: string) => writes.setPrimary(clientId, contactId),
    onSuccess: () => {
      toast.success("Primary contact updated");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="t-overline text-muted">Contacts</p>
        <Button
          size="sm"
          variant="line"
          onClick={() => {
            setDuplicateEmailWarning(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {!hasAny ? (
        <div className="rounded-[var(--r)] border-2 border-dashed border-line-2 p-4 text-center text-ui-text text-muted">
          <Users className="mx-auto mb-1 h-5 w-5 opacity-60" />
          No contacts yet. A client with no contacts is still valid — add one when
          you know who to send quotes and dockets to.
        </div>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-[var(--r)] border border-line p-2.5">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-label={c.isPrimary ? `${c.name || "Contact"} is the primary contact` : `Make ${c.name || "this contact"} primary`}
                  onClick={() => !c.isPrimary && setPrimary.mutate(c.id)}
                  className={cn("mt-0.5 shrink-0 rounded-sm transition-colors", focusRing, c.isPrimary ? "text-red" : "text-faint hover:text-red/60")}
                >
                  <Star className={cn("h-4 w-4", c.isPrimary && "fill-current")} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{c.name || c.email || c.phone}</span>
                    {c.role && <span className="text-badge text-muted">{c.role}</span>}
                    {c.isPrimary && <span className="rounded-full bg-red-soft px-2 py-0.5 text-[11px] font-semibold text-ink">Primary</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className={cn("flex items-center gap-1 rounded-sm hover:text-ink-2 hover:underline", focusRing)}>
                        <Mail className="h-3 w-3" /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className={cn("flex items-center gap-1 rounded-sm hover:text-ink-2 hover:underline", focusRing)}>
                        <Phone className="h-3 w-3" /> {c.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon" variant="ghost" className="touch-target size-7" onClick={() => setEditing(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="touch-target size-7" onClick={() => remove.mutate(c.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ContactDialog
          contact={null}
          onClose={() => {
            setOpen(false);
            setDuplicateEmailWarning(null);
          }}
          onSave={(values) => {
            checkDuplicateEmail(values.email || undefined);
            add.mutate(values);
          }}
          saving={add.isPending}
        />
      )}

      {duplicateEmailWarning && (
        <p className="text-caption text-t-out" role="status">{duplicateEmailWarning}</p>
      )}

      {editing && (
        <ContactDialog
          key={editing.id}
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            checkDuplicateEmail(values.email || undefined, editing.id);
            update.mutate(values);
          }}
          saving={update.isPending}
        />
      )}
    </div>
  );
}
