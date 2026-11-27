import { z } from "zod";

import { ASSIGNABLE_ROLES, MAX_TEAM_BULK } from "@/lib/member-role-policy";

/** Ids for a Team write: bounded server-side, de-duplicated (R-8.6.2, R-9.3). */
const idList = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(MAX_TEAM_BULK)
  .transform((ids) => [...new Set(ids)]);

export const changeRolesSchema = z.object({
  memberIds: idList,
  role: z.string().refine((r) => ASSIGNABLE_ROLES.includes(r), { message: "Invalid role" }),
});
export type ChangeRolesInput = z.input<typeof changeRolesSchema>;

export const memberIdsSchema = z.object({ memberIds: idList });
export const invitationIdsSchema = z.object({ invitationIds: idList });

export const undoTeamSchema = z.object({ token: z.string().min(10).max(4000) });

/** The invite body (R-8.6.2): a real address, and a role that is exactly one of the assignable roles. */
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("That doesn't look like an email address.").max(254),
  role: z.string().refine((r) => ASSIGNABLE_ROLES.includes(r), { message: "Invalid role" }),
});
