"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { indexTaskLinks, type TaskLink, type TaskLinkIndex, type TaskLinkKind } from "@/lib/task-links";
import { api } from "../../convex/_generated/api";

/**
 * Every task link on a job, ONE bounded read (`projectTaskLinks.listForProject`), indexed
 * by task and by target for the chips, the sheet, a file's back-reference and the picker.
 */
export function useTaskLinks(projectId: string): TaskLinkIndex & { links: TaskLink[]; truncated: boolean } {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const data = useAuthedQuery(api.projectTaskLinks.listForProject, orgId ? { orgId, projectId } : "skip");
  const links = React.useMemo(() => (data?.links ?? []) as TaskLink[], [data]);
  const index = React.useMemo(() => indexTaskLinks(links), [links]);
  return { ...index, links, truncated: data?.truncated ?? false };
}

/**
 * The two link writes. Each toasts once and hands the toast its EXACT Undo from one
 * closure (`announceListWrite`); the Undo takes ids only (the server reads what to
 * restore from the forward write's own audit row). A link that already existed
 * (`created: false`) toasts a plain note and offers no Undo. An Undo never touches a
 * stored file: a link only points at one.
 */
export function useTaskLinkActions() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const linkM = useMutation(api.projectTaskLinksWrites.linkNative);
  const unlinkM = useMutation(api.projectTaskLinksWrites.unlinkNative);
  const undoLinkM = useMutation(api.projectTaskLinksWrites.undoLinkNative);
  const undoUnlinkM = useMutation(api.projectTaskLinksWrites.undoUnlinkNative);
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });

  return {
    async link(task: { id: string; title: string }, target: { kind: TaskLinkKind; id: string; label: string }) {
      if (!orgId) return;
      const id = createId();
      const auditId = createId();
      try {
        const r = await linkM({ id, orgId, taskId: task.id, linkedKind: target.kind, linkedId: target.id, now: Date.now(), actor: actor(), auditId });
        if (!r.created) {
          announceListWrite({ title: `“${task.title}” is already linked to “${target.label}”`, undoneTitle: "" });
          return;
        }
        announceListWrite({
          title: `Linked “${task.title}” to “${target.label}”`,
          undoneTitle: `Unlinked “${target.label}”`,
          performUndo: async () => {
            await undoLinkM({ id, orgId, auditId, now: Date.now(), actor: actor() });
          },
        });
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't link the task" });
      }
    },

    async unlink(link: TaskLink, taskTitle: string) {
      if (!orgId) return;
      const auditId = createId();
      try {
        await unlinkM({ id: link.id, orgId, now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Unlinked “${link.label}” from “${taskTitle}”`,
          undoneTitle: `Linked “${link.label}” again`,
          performUndo: async () => {
            await undoUnlinkM({ id: link.id, orgId, auditId, now: Date.now(), actor: actor() });
          },
        });
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't remove the link" });
      }
    },
  };
}
