"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive crew-roster hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * crew_member / crew_role / crew_skill tables over a WebSocket, so any roster
 * create/update/delete (via the dual-write server actions) pushes a live update
 * to every subscriber. No staleTime, no manual invalidation. Pass `undefined` to
 * skip (e.g. before org context loads).
 *
 * Scope note: only the roster trio is reactive. The project-coupled
 * scheduling/timesheet sub-tables (assignment/shift/availability/time_entry)
 * stay on server actions over the fresh Prisma mirror — they compose
 * Prisma-resident projects/users. A member's skills (implicit m2m) and linked
 * user are also cross-domain — merged in non-reactively via
 * getCrewMemberExtras(). Lives in src/hooks (NOT convex/) so the Convex bundler
 * never tries to bundle this React module. See FEATUREDOCS/54.
 */
export type CrewMemberDoc = Doc<"crewMembers">;
export type CrewRoleDoc = Doc<"crewRoles">;
export type CrewSkillDoc = Doc<"crewSkills">;

export function useCrewMember(id: string | undefined): CrewMemberDoc | null | undefined {
  return useAuthedQuery(api.crewMembers.getById, id ? { id } : "skip");
}

export function useCrewRoles(orgId: string | undefined): CrewRoleDoc[] | undefined {
  return useAuthedQuery(api.crewRoles.list, orgId ? { orgId } : "skip");
}

export function useCrewSkills(orgId: string | undefined): CrewSkillDoc[] | undefined {
  return useAuthedQuery(api.crewSkills.list, orgId ? { orgId } : "skip");
}
