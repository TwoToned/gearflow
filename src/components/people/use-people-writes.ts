"use client";

import type { MutableRefObject } from "react";
import { useConvex, useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { MAX_TAGS, MAX_TAG_LEN, cleanTag } from "../../../convex/lib/tagLimits";

import { runBulk, type BulkOutcome } from "@/lib/bulk-run";
import { useSession } from "@/lib/auth-client";
import { announceListWrite, listWriteTitle, plural } from "@/lib/list-write-toast";
import { clientsCsv, suppliersCsv, crewName, type ClientSource, type CrewSource, type SupplierSource } from "@/lib/list-views/people";
import { showError } from "@/lib/show-error";

/**
 * Every write behind the People lists' row and bulk menus (UX Phase 13). Each is an
 * EXISTING mutation (crew/client `updateNative`, `archiveManyNative`, supplier
 * `patchNative`) plus `createManyNative` for Assign. A reversible one toasts with
 * Undo from ONE guarded closure (`announceListWrite`); an Undo restores only rows
 * whose LIVE value (read at undo time, never the snapshot) is still what the write
 * set, and names the rest. Mail (`Message`) is a `mailto:` the user sends themselves.
 */
type Seen<R> = MutableRefObject<Map<string, R>>;

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

function summarise<R>(noun: string, done: string, out: BulkOutcome<R>, undo?: () => Promise<string | void>) {
  announceListWrite({
    title: listWriteTitle(done, out.skipped),
    undoneTitle: `Undone · ${plural(out.done.length, noun)} restored`,
    performUndo: out.done.length > 0 ? undo : undefined,
  });
}

/** The tags after adding `tag`, or why it cannot be added. Pure; the tag list is bounded (MAX_TAGS). */
function withTag(tags: string[] | null | undefined, tag: string): { tags: string[] } | { skip: string } {
  const have = tags ?? [];
  if (have.includes(tag)) return { skip: `already tagged ${tag}` };
  if (have.length >= MAX_TAGS) return { skip: `already has ${MAX_TAGS} tags` };
  return { tags: [...have, tag] };
}

// ─── Crew ────────────────────────────────────────────────────────────────

export function useCrewListWrites(orgId: string | undefined, seen: Seen<CrewSource>) {
  const convex = useConvex();
  const actor = useActor();
  const update = useMutation(api.crewWrites.updateNative);
  const createMany = useMutation(api.crewAssignmentsWrites.createManyNative);
  const deleteMany = useMutation(api.crewAssignmentsWrites.bulkDeleteNative);
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is CrewSource => !!r);
  const set = (id: string, patch: Record<string, unknown>) =>
    update({ id, orgId: orgId!, set: { ...patch, updatedAt: Date.now() }, clear: [], actor: actor(), auditId: createId(), now: Date.now() });
  const live = async (id: string) => (await convex.query(api.crewMembers.getById, { id })) as { status?: string; tags?: string[] } | null;

  async function bulkDeactivate(ids: string[]) {
    const out = await runBulk(pick(ids), {
      name: crewName,
      gate: (r) => (r.listStatus === "INACTIVE" ? "already inactive" : r.next?.status === "CONFIRMED" ? "has a confirmed call" : null),
      apply: (r) => set(r.id, { status: "INACTIVE" }).then(() => undefined),
    });
    summarise("crew member", `Deactivated ${plural(out.done.length, "crew member")}`, out, async () => {
      let moved = 0;
      for (const r of out.done) {
        if ((await live(r.id))?.status !== "INACTIVE") { moved++; continue; }
        await set(r.id, { status: r.status ?? "ACTIVE" });
      }
      return moved > 0 ? `${plural(moved, "crew member")} had changed since, left as ${moved === 1 ? "it is" : "they are"}` : undefined;
    });
  }

  async function reactivateOne(id: string) {
    const row = seen.current.get(id);
    try {
      await set(id, { status: "ACTIVE" });
      announceListWrite({
        title: `${row ? crewName(row) : "Crew member"} reactivated`,
        undoneTitle: "Undone · back to inactive",
        performUndo: async () => {
          if ((await live(id))?.status === "ACTIVE") await set(id, { status: row?.status ?? "INACTIVE" });
        },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reactivate" });
    }
  }

  async function bulkTag(ids: string[], raw: string) {
    const tag = tagOf(raw);
    if (!tag) return;
    const changed: { id: string; before: string[] }[] = [];
    const out = await runBulk(pick(ids), {
      name: crewName,
      gate: (r) => ("skip" in withTag(r.tags, tag) ? (withTag(r.tags, tag) as { skip: string }).skip : null),
      apply: async (r) => {
        const next = withTag(r.tags, tag) as { tags: string[] };
        await set(r.id, { tags: next.tags });
        changed.push({ id: r.id, before: r.tags ?? [] });
      },
    });
    summarise("crew member", `Tagged ${plural(out.done.length, "crew member")} ${tag}`, out, async () => {
      for (const c of changed) {
        const l = await live(c.id);
        if (l?.tags?.includes(tag)) await set(c.id, { tags: (l.tags ?? []).filter((t) => t !== tag) });
      }
    });
  }

  /** ONE transaction; unsent PENDING calls; Undo is `bulkDeleteNative` over exactly the created ids. */
  async function assign(ids: string[], job: { id: string; projectNumber: string; startDate?: number | null; endDate?: number | null }) {
    try {
      const res = await createMany({
        orgId: orgId!, projectId: job.id, items: ids.map((id) => ({ id: createId(), crewMemberId: id })),
        ...(job.startDate != null ? { startDate: job.startDate } : {}), ...(job.endDate != null ? { endDate: job.endDate } : {}),
        now: Date.now(), actor: actor(), auditId: createId(),
      });
      const names = (cid: string) => { const r = seen.current.get(cid); return r ? crewName(r) : cid; };
      const skipped = res.skipped.map((s) => ({ name: names(s.crewMemberId), why: s.reason }));
      const createdIds = res.created.map((c) => c.id);
      announceListWrite({
        title: listWriteTitle(`Assigned ${plural(createdIds.length, "crew member")} to ${job.projectNumber} · offers not sent yet`, skipped),
        undoneTitle: `Undone · ${plural(createdIds.length, "call")} removed`,
        performUndo: createdIds.length > 0 ? async () => { await deleteMany({ orgId: orgId!, ids: createdIds, now: Date.now(), actor: actor(), auditId: createId() }); } : undefined,
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

  return { bulkDeactivate, reactivateOne, bulkTag, assign, message };
}

// ─── Clients ─────────────────────────────────────────────────────────────

export function useClientListWrites(orgId: string | undefined, seen: Seen<ClientSource>) {
  const convex = useConvex();
  const actor = useActor();
  const update = useMutation(api.clientWrites.updateNative);
  const archiveMany = useMutation(api.clientWrites.archiveManyNative);
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is ClientSource => !!r);
  const patch = (id: string, p: { tags?: string[]; isActive?: boolean }) => update({ id, orgId: orgId!, patch: p, actor: actor(), auditId: createId(), now: Date.now() });
  const live = async (id: string) => (await convex.query(api.clients.getById, { id })) as { isActive?: boolean; tags?: string[] } | null;

  async function bulkArchive(ids: string[]) {
    const out = await runBulk(pick(ids), {
      name: (r) => r.name,
      gate: (r) => (!r.isActive ? "already archived" : r.openJobCount > 0 ? "has open jobs" : null),
      apply: () => Promise.resolve(),
    });
    if (out.done.length > 0) {
      try {
        await archiveMany({ orgId: orgId!, items: out.done.map((r) => ({ id: r.id, auditId: createId() })), actor: actor(), now: Date.now() });
      } catch (e) {
        return showError(e, { fallbackTitle: "Could not archive the clients" });
      }
    }
    summarise("client", `Archived ${plural(out.done.length, "client")}`, out, async () => {
      let moved = 0;
      for (const r of out.done) {
        if ((await live(r.id))?.isActive !== false) { moved++; continue; }
        await patch(r.id, { isActive: true });
      }
      return moved > 0 ? `${plural(moved, "client")} had changed since, left as ${moved === 1 ? "it is" : "they are"}` : undefined;
    });
  }

  async function archiveOne(id: string) {
    await bulkArchive([id]);
  }

  async function reactivateOne(id: string) {
    try {
      await patch(id, { isActive: true });
      announceListWrite({
        title: `${seen.current.get(id)?.name ?? "Client"} reactivated`,
        undoneTitle: "Undone · archived again",
        performUndo: async () => { if ((await live(id))?.isActive !== false) await patch(id, { isActive: false }); },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reactivate" });
    }
  }

  async function bulkTag(ids: string[], raw: string) {
    const tag = tagOf(raw);
    if (!tag) return;
    const changed: string[] = [];
    const out = await runBulk(pick(ids), {
      name: (r) => r.name,
      gate: (r) => ("skip" in withTag(r.tags, tag) ? (withTag(r.tags, tag) as { skip: string }).skip : null),
      apply: async (r) => { await patch(r.id, { tags: (withTag(r.tags, tag) as { tags: string[] }).tags }); changed.push(r.id); },
    });
    summarise("client", `Tagged ${plural(out.done.length, "client")} ${tag}`, out, async () => {
      for (const id of changed) {
        const l = await live(id);
        if (l?.tags?.includes(tag)) await patch(id, { tags: (l.tags ?? []).filter((t) => t !== tag) });
      }
    });
  }

  function bulkExport(ids: string[]) {
    const rows = pick(ids);
    downloadCsv(clientsCsv(rows), "clients.csv");
    toast.success(`Exported ${plural(rows.length, "client")}`);
  }

  return { bulkArchive, archiveOne, reactivateOne, bulkTag, bulkExport };
}

// ─── Suppliers ───────────────────────────────────────────────────────────

export function useSupplierListWrites(orgId: string | undefined, seen: Seen<SupplierSource>) {
  const convex = useConvex();
  const actor = useActor();
  const patchM = useMutation(api.suppliersWrites.patchNative);
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is SupplierSource => !!r);
  const patch = (id: string, p: { tags?: string[]; isActive?: boolean }) => patchM({ id, orgId: orgId!, patch: p, now: Date.now(), actor: actor(), auditId: createId() });
  const live = async (id: string) => (await convex.query(api.suppliers.getById, { id })) as { isActive?: boolean; tags?: string[] } | null;

  async function bulkArchive(ids: string[]) {
    const out = await runBulk(pick(ids), {
      name: (r) => r.name,
      gate: (r) => (!r.isActive ? "already archived" : null),
      apply: (r) => patch(r.id, { isActive: false }).then(() => undefined),
    });
    summarise("supplier", `Archived ${plural(out.done.length, "supplier")}`, out, async () => {
      let moved = 0;
      for (const r of out.done) {
        if ((await live(r.id))?.isActive !== false) { moved++; continue; }
        await patch(r.id, { isActive: true });
      }
      return moved > 0 ? `${plural(moved, "supplier")} had changed since, left as ${moved === 1 ? "it is" : "they are"}` : undefined;
    });
  }

  async function reactivateOne(id: string) {
    try {
      await patch(id, { isActive: true });
      announceListWrite({
        title: `${seen.current.get(id)?.name ?? "Supplier"} reactivated`,
        undoneTitle: "Undone · archived again",
        performUndo: async () => { if ((await live(id))?.isActive !== false) await patch(id, { isActive: false }); },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reactivate" });
    }
  }

  async function bulkTag(ids: string[], raw: string) {
    const tag = tagOf(raw);
    if (!tag) return;
    const changed: string[] = [];
    const out = await runBulk(pick(ids), {
      name: (r) => r.name,
      gate: (r) => ("skip" in withTag(r.tags, tag) ? (withTag(r.tags, tag) as { skip: string }).skip : null),
      apply: async (r) => { await patch(r.id, { tags: (withTag(r.tags, tag) as { tags: string[] }).tags }); changed.push(r.id); },
    });
    summarise("supplier", `Tagged ${plural(out.done.length, "supplier")} ${tag}`, out, async () => {
      for (const id of changed) {
        const l = await live(id);
        if (l?.tags?.includes(tag)) await patch(id, { tags: (l.tags ?? []).filter((t) => t !== tag) });
      }
    });
  }

  function bulkExport(ids: string[]) {
    const rows = pick(ids);
    downloadCsv(suppliersCsv(rows), "suppliers.csv");
    toast.success(`Exported ${plural(rows.length, "supplier")}`);
  }

  return { bulkArchive, reactivateOne, bulkTag, bulkExport };
}
