"use server";

import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  changeMemberRoles,
  loadActor,
  peekTeamUndoKind,
  removeMembers,
  resendInvitations,
  revokeInvitations,
  undoTeamChange,
} from "@/lib/team-writes";
import {
  changeRolesSchema,
  invitationIdsSchema,
  memberIdsSchema,
  undoTeamSchema,
  type ChangeRolesInput,
} from "@/lib/validations/team";

/**
 * Settings → Team writes (UX Phase 17, D58/D59). Each is a thin gate: parse the
 * body with Zod, `requirePermission` for the verb, then call the core in
 * `src/lib/team-writes.ts`, which applies the one role policy per row and
 * reports what it skipped. The permission names the verb: `update_role`,
 * `remove`, `invite` (which also covers resend and revoke, as it always did).
 */

export async function changeMemberRolesAction(input: ChangeRolesInput) {
  const data = changeRolesSchema.parse(input);
  const ctx = await requirePermission("orgMembers", "update_role");
  const actor = await loadActor(ctx);
  return serialize(await changeMemberRoles(actor, data.memberIds, data.role));
}

export async function removeMembersAction(input: { memberIds: string[] }) {
  const data = memberIdsSchema.parse(input);
  const ctx = await requirePermission("orgMembers", "remove");
  const actor = await loadActor(ctx);
  return serialize(await removeMembers(actor, data.memberIds));
}

export async function resendInvitationsAction(input: { invitationIds: string[] }) {
  const data = invitationIdsSchema.parse(input);
  const ctx = await requirePermission("orgMembers", "invite");
  const actor = await loadActor(ctx);
  return serialize(await resendInvitations(actor, data.invitationIds));
}

export async function revokeInvitationsAction(input: { invitationIds: string[] }) {
  const data = invitationIdsSchema.parse(input);
  const ctx = await requirePermission("orgMembers", "invite");
  const actor = await loadActor(ctx);
  return serialize(await revokeInvitations(actor, data.invitationIds));
}

/** Reverse one Team write. Takes ONLY the server-signed token the write returned. */
export async function undoTeamChangeAction(input: { token: string }) {
  const data = undoTeamSchema.parse(input);
  const kind = peekTeamUndoKind(data.token);
  const ctx = await requirePermission("orgMembers", kind === "role" ? "update_role" : "invite");
  const actor = await loadActor(ctx);
  return serialize(await undoTeamChange(actor, data.token));
}
