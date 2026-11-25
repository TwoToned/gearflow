"use client";

import type { MutableRefObject } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { MAX_TAG_LEN, cleanTag } from "../../../convex/lib/tagLimits";

import { useSession } from "@/lib/auth-client";
import { announceListWrite, listWriteTitle, plural } from "@/lib/list-write-toast";
import { clientsCsv, suppliersCsv, crewName, type ClientSource, type CrewSource, type SupplierSource } from "@/lib/list-views/people";
import { showError } from "@/lib/show-error";

/**
 * Every write behind the People lists' row and bulk menus (UX Phase 13). Tag / deactivate /
 * archive / reactivate go through `convex/peopleBulkWrites.ts`: ONE transaction that records
 * one exact audit row per changed record, with per-row gates run (and named) on the SERVER.
 * Their Undo is `undoManyNative` with only `{ id, auditId }` pairs; the server restores a
 * record only while it is still exactly as that write left it, as its author, inside the
 * window, once, and names the rest. No client snapshot is ever written back. Mail
 * (`Message`) is a `mailto:` the user sends themselves.
 */
type Seen<R> = MutableRefObject<Map<string, R>>;
type Kind = "crew" | "client" | "supplier";

const tagOf = (raw: string) => cleanTag(raw).slice(0, MAX_TAG_LEN).toLowerCase();

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function useActor() {
  const { data: session } = useSession();
  return () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
}

interface Outcome { changed: { id: string; auditId: string }[]; skipped: { id: string; name: string; reason: string }[] }

/** The one bulk-write driver for all three lists: forward write, then ONE toast whose Undo is the server's. */
function usePeopleBulk(kind: Kind, orgId: string | undefined, noun: string) {
  const actor = useActor();
  const addTagM = useMutation(api.peopleBulkWrites.addTagManyNative);
  const setActiveM = useMutation(api.peopleBulkWrites.setActiveManyNative);
  const undoM = useMutation(api.peopleBulkWrites.undoManyNative);

  const announce = (out: Outcome, done: string) => {
    const skipped = out.skipped.filter((s) => s.reason !== "nothing to change").map((s) => ({ name: s.name, why: s.reason }));
    announceListWrite({
      title: listWriteTitle(done, skipped),
      undoneTitle: `Undone · ${plural(out.changed.length, noun)} restored`,
      performUndo: out.changed.length > 0
        ? async () => {
            const r = await undoM({ orgId: orgId!, kind, items: out.changed, now: Date.now(), actor: actor() });
            return r.kept.length > 0 ? `${plural(r.restored.length, noun)} restored · ${r.kept.length} had changed since and stayed` : undefined;
          }
        : undefined,
    });
  };

  const items = (ids: string[]) => ids.map((id) => ({ id, auditId: createId() }));
  return {
    async addTag(ids: string[], raw: string) {
      const tag = tagOf(raw);
      if (!tag) return;
      try {
        const out = await addTagM({ orgId: orgId!, kind, items: items(ids), tag, now: Date.now(), actor: actor() });
        announce(out, `Tagged ${plural(out.changed.length, noun)} ${tag}`);
      } catch (e) {
        showError(e, { fallbackTitle: "Could not add the tag" });
      }
    },
    async setActive(ids: string[], active: boolean) {
      try {
        const out = await setActiveM({ orgId: orgId!, kind, items: items(ids), active, todayMs: Date.now(), now: Date.now(), actor: actor() });
        const verb = active ? "Reactivated" : kind === "crew" ? "Deactivated" : "Archived";
        announce(out, `${verb} ${plural(out.changed.length, noun)}`);
      } catch (e) {
        showError(e, { fallbackTitle: active ? "Could not reactivate" : "Could not complete that" });
      }
    },
  };
}

// ─── Crew ────────────────────────────────────────────────────────────────

export function useCrewListWrites(orgId: string | undefined, seen: Seen<CrewSource>) {
  const actor = useActor();
  const bulk = usePeopleBulk("crew", orgId, "crew member");
  const createMany = useMutation(api.crewAssignmentsWrites.createManyNative);
  const undoCreateMany = useMutation(api.crewAssignmentsWrites.undoCreateManyNative);
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is CrewSource => !!r);

  /** ONE transaction; unsent PENDING calls; the Undo is server-side and exact (keeps any call that moved on). */
  async function assign(ids: string[], job: { id: string; projectNumber: string; startDate?: number | null; endDate?: number | null }) {
    try {
      const auditId = createId();
      const res = await createMany({
        orgId: orgId!, projectId: job.id, items: ids.map((id) => ({ id: createId(), crewMemberId: id })),
        ...(job.startDate != null ? { startDate: job.startDate } : {}), ...(job.endDate != null ? { endDate: job.endDate } : {}),
        now: Date.now(), actor: actor(), auditId,
      });
      const names = (cid: string) => { const r = seen.current.get(cid); return r ? crewName(r) : cid; };
      const skipped = res.skipped.map((s) => ({ name: names(s.crewMemberId), why: s.reason }));
      const created = res.created.length;
      announceListWrite({
        title: listWriteTitle(`Assigned ${plural(created, "crew member")} to ${job.projectNumber} · offers not sent yet`, skipped),
        undoneTitle: `Undone · ${plural(created, "call")} removed`,
        performUndo: created > 0
          ? async () => {
              const r = await undoCreateMany({ orgId: orgId!, forwardAuditId: auditId, now: Date.now(), actor: actor() });
              return r.kept.length > 0 ? `${plural(r.removed, "call")} removed · ${r.kept.length} stayed (${r.reasons.join(", ")})` : undefined;
            }
          : undefined,
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not assign to the job" });
    }
  }

  /** Mail is the user's own: a `mailto:` with every ticked address in Bcc. People without an email are named. */
  function message(ids: string[]) {
    const rows = pick(ids);
    const withEmail = rows.filter((r) => !!r.email);
    const without = rows.filter((r) => !r.email).map(crewName);
    if (withEmail.length === 0) return toast.error("None of the selected crew have an email address");
    window.location.href = `mailto:?bcc=${encodeURIComponent(withEmail.map((r) => r.email).join(","))}`;
    if (without.length) toast.message(`No email for ${without.slice(0, 4).join(", ")}${without.length > 4 ? ` +${without.length - 4} more` : ""}`);
  }

  return {
    bulkDeactivate: (ids: string[]) => bulk.setActive(ids, false),
    reactivateOne: (id: string) => bulk.setActive([id], true),
    bulkTag: bulk.addTag,
    assign,
    message,
  };
}

// ─── Clients ─────────────────────────────────────────────────────────────

export function useClientListWrites(orgId: string | undefined, seen: Seen<ClientSource>) {
  const bulk = usePeopleBulk("client", orgId, "client");
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is ClientSource => !!r);
  return {
    bulkArchive: (ids: string[]) => bulk.setActive(ids, false),
    archiveOne: (id: string) => bulk.setActive([id], false),
    reactivateOne: (id: string) => bulk.setActive([id], true),
    bulkTag: bulk.addTag,
    bulkExport(ids: string[]) {
      const rows = pick(ids);
      downloadCsv(clientsCsv(rows), "clients.csv");
      toast.success(`Exported ${plural(rows.length, "client")}`);
    },
  };
}

// ─── Suppliers ───────────────────────────────────────────────────────────

export function useSupplierListWrites(orgId: string | undefined, seen: Seen<SupplierSource>) {
  const bulk = usePeopleBulk("supplier", orgId, "supplier");
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is SupplierSource => !!r);
  return {
    bulkArchive: (ids: string[]) => bulk.setActive(ids, false),
    reactivateOne: (id: string) => bulk.setActive([id], true),
    bulkTag: bulk.addTag,
    bulkExport(ids: string[]) {
      const rows = pick(ids);
      downloadCsv(suppliersCsv(rows), "suppliers.csv");
      toast.success(`Exported ${plural(rows.length, "supplier")}`);
    },
  };
}
