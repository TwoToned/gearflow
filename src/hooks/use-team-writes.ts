"use client";
// use-client: runs server actions and toasts with Undo (R-8.1.1)

import { useCallback } from "react";

import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { teamToast, type TeamVerb } from "@/lib/team-model";
import {
  changeMemberRolesAction,
  removeMembersAction,
  resendInvitationsAction,
  revokeInvitationsAction,
  undoTeamChangeAction,
} from "@/server/team";
import { refreshOrgMembers } from "@/hooks/use-org-members";
import { refreshPendingInvitations } from "@/hooks/use-pending-invitations";
import { refreshCurrentRole } from "@/hooks/use-current-role";

type WriteResult = { changed: number; skipped: { id: string; label: string; reason: string }[]; undoToken: string | null };

/**
 * Every Team write: run the action, refresh the shared stores, then ONE toast
 * (`announceListWrite`) that names what changed and what was skipped and offers
 * Undo from the signed token the server returned (absent when there is no exact
 * reverse, as for a removal). The client never supplies a "restore to" value.
 */
export function useTeamWrites(orgId: string | undefined) {
  const refresh = useCallback(() => {
    refreshOrgMembers(orgId);
    refreshPendingInvitations(orgId);
    refreshCurrentRole(orgId);
  }, [orgId]);

  const run = useCallback(
    async (verb: TeamVerb, call: () => Promise<WriteResult>, role?: string) => {
      let res: WriteResult;
      try {
        res = await call();
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't save" });
        return;
      }
      refresh();
      const { title, undoneTitle } = teamToast(verb, res, role);
      const token = res.undoToken;
      announceListWrite({
        title,
        undoneTitle,
        performUndo: token
          ? async () => {
              await undoTeamChangeAction({ token });
              refresh();
            }
          : undefined,
      });
    },
    [refresh],
  );

  return {
    changeRoles: (memberIds: string[], role: string) => run("role", () => changeMemberRolesAction({ memberIds, role }), role),
    removeMembers: (memberIds: string[]) => run("remove", () => removeMembersAction({ memberIds })),
    resend: (invitationIds: string[]) => run("resend", () => resendInvitationsAction({ invitationIds })),
    revoke: (invitationIds: string[]) => run("revoke", () => revokeInvitationsAction({ invitationIds })),
  };
}
