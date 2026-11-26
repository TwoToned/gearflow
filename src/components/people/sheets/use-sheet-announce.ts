"use client";

import { useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";

/**
 * The ONE toast every People sheet save uses. A create's Undo is `peopleCreateUndo.undoCreateNative` and an edit's is
 * the server's exact field-edit Undo (`peopleBulkWrites.undoManyNative` for clients, suppliers and crew,
 * `supplierOrdersWrites.undoHireChangeNative` for an order): each takes ids only (the forward write's `auditId`), so the
 * server decides, as the author, inside the window, once, and only while the record is still as that save left it.
 * A refusal is shown as the toast's error and changes nothing.
 */
export type PeopleKind = "client" | "supplier" | "crew" | "supplierOrder";
export interface SavedRecord { id: string; auditId: string }

export function useSheetAnnounce(kind: PeopleKind) {
  const orgId = useActiveOrganization().data?.id;
  const { data: session } = useSession();
  const undoCreate = useMutation(api.peopleCreateUndo.undoCreateNative);
  const undoPeople = useMutation(api.peopleBulkWrites.undoManyNative);
  const undoOrder = useMutation(api.supplierOrdersWrites.undoHireChangeNative);
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });

  return {
    created(noun: string, name: string, saved: SavedRecord) {
      return announceListWrite({
        title: `Created ${noun} ${name}`,
        undoneTitle: `Undone · ${name} removed`,
        performUndo: async () => {
          await undoCreate({ orgId: orgId!, kind, id: saved.id, forwardAuditId: saved.auditId, now: Date.now(), actor: actor() });
        },
      });
    },
    updated(noun: string, name: string, saved: SavedRecord) {
      return announceListWrite({
        title: `Saved ${noun} ${name}`,
        undoneTitle: `Undone · ${name} restored`,
        performUndo: async () => {
          if (kind === "supplierOrder") {
            await undoOrder({ id: saved.id, orgId: orgId!, forwardAuditId: saved.auditId, now: Date.now(), actor: actor() });
            return;
          }
          const r = await undoPeople({ orgId: orgId!, kind, items: [{ id: saved.id, auditId: saved.auditId }], now: Date.now(), actor: actor() });
          if (r.kept.length > 0) return `${name} was changed since, so it was left as it is (${r.kept[0].reason})`;
        },
      });
    },
  };
}
