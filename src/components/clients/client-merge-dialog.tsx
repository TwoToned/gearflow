"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";

import { api } from "../../../convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useClients } from "@/hooks/use-clients";
import { useSession } from "@/lib/auth-client";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * Merge a client into another (D73): pick the client to KEEP, see exactly what moves
 * (a named, bounded list from the one-shot preview; it fails open to the counts), confirm.
 * The toast's Undo is `undoClientMergeNative` with only the forward audit id; anything the
 * user re-pointed since stays and is named.
 */
export function ClientMergeDialog({
  open,
  onOpenChange,
  orgId,
  loser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  loser: { id: string; name: string };
}) {
  const { data: session } = useSession();
  const clients = useClients(orgId);
  const merge = useMutation(api.clientMergeWrites.mergeClientsNative);
  const undo = useMutation(api.clientMergeWrites.undoClientMergeNative);
  const [search, setSearch] = React.useState("");
  const [keepId, setKeepId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const preview = useAuthedQuery(api.clientMergeWrites.mergePreview, open && orgId && keepId ? { orgId, survivorId: keepId, loserId: loser.id } : "skip");

  const options = (clients ?? [])
    .filter((c) => c.id !== loser.id && (c.isActive ?? true) && c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 8);
  const keep = (clients ?? []).find((c) => c.id === keepId);
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });

  async function run() {
    if (!orgId || !keepId || !keep) return;
    setBusy(true);
    try {
      const auditId = createId();
      const res = await merge({ orgId, survivorId: keepId, loserId: loser.id, auditId, receivedAuditId: createId(), now: Date.now(), actor: actor() });
      const c = res.counts;
      announceListWrite({
        title: `Merged ${loser.name} into ${keep.name} · ${plural(c.projects, "job")}, ${plural(c.invoices, "invoice")}, ${plural(c.contacts, "contact")} moved`,
        undoneTitle: `Undone · ${loser.name} restored`,
        performUndo: async () => {
          const r = await undo({ orgId, forwardAuditId: auditId, now: Date.now(), actor: actor() });
          return r.left.length > 0 ? `${loser.name} restored · ${plural(r.left.length, "record")} had changed since and stayed` : undefined;
        },
      });
      onOpenChange(false);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not merge the clients" });
    } finally {
      setBusy(false);
    }
  }

  const c = preview?.counts;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {loser.name} into…</DialogTitle>
          <DialogDescription>Pick the client to keep. {loser.name} is archived and its records move across.</DialogDescription>
        </DialogHeader>
        <Input type="search" aria-label="Search clients" placeholder="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 text-base md:h-9 md:text-ui-text" />
        <ul className="max-h-40 divide-y divide-line overflow-y-auto">
          {options.map((o) => (
            <li key={o.id}>
              <Button variant="ghost" aria-pressed={o.id === keepId} className="h-auto min-h-11 w-full justify-start px-1 text-left" onClick={() => setKeepId(o.id)}>
                <span className={o.id === keepId ? "font-semibold text-ink" : "text-ink"}>{o.name}</span>
              </Button>
            </li>
          ))}
          {options.length === 0 && <li className="py-2 text-table-cell text-muted">No other active clients match.</li>}
        </ul>
        {keepId && (
          <section aria-label="What moves" className="text-table-cell">
            {!preview ? <p className="text-muted">Checking what moves…</p> : (
              <>
                <p className="text-ink">
                  Keeps <strong>{preview.survivor.name}</strong>. Moves {plural(c!.projects, "job")}, {plural(c!.invoices, "invoice")}, {plural(c!.contacts, "contact")}, {plural(c!.media, "file")}
                  {c!.skippedMedia ? ` (${plural(c!.skippedMedia, "duplicate file")} stay)` : ""}.
                </p>
                {preview.jobs.length > 0 && <p className="mt-1 text-muted">Jobs: {preview.jobs.map((j) => j.projectNumber).join(", ")}</p>}
                <p className="mt-1 text-muted">Not moved: activity history, stored PDFs, and either client&apos;s Xero mapping.</p>
              </>
            )}
          </section>
        )}
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void run()} disabled={!keepId || busy} loading={busy}>Merge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
