import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Crew roster entities — crew_member, crew_role, crew_skill — are DUAL-WRITTEN:
 * every create/update/delete writes the Prisma row (the durable FK anchor) AND
 * mirrors to the matching Convex table. Prisma is written first; the Convex payload
 * is derived from the written row via toConvexDoc so the two can't drift; the
 * backfill doubles as the heal path.
 *
 * Dual-write (not hard cutover) because live inbound FKs from tables that stay in
 * Prisma cross the boundary: `project_service.crewRoleId` → crew_role;
 * `damage_event` / `project_task` / `discord_account_link` / `discord_link_token`
 * → crew_member; and the implicit m2m `_CrewMemberToCrewSkill` (which has NO Convex
 * representation — a member's skills stay composed on the Prisma mirror). See
 * FEATUREDOCS/54.
 *
 * SCOPE: only the roster trio is mirrored. The project-coupled scheduling/timesheet
 * sub-tables (crew_assignment, crew_shift, crew_availability, crew_certification,
 * crew_time_entry) stay Prisma-only for now — they are leaf/child tables with
 * cascade-delete semantics Convex can't cheaply replicate, and they are only ever
 * composed inside project-joining or member-detail views that stay on the Prisma
 * mirror. Their Convex CRUD + schema already exist (Phase 2); they get dual-written
 * when their UIs go reactive alongside the project/central-graph migration.
 *
 * crew_member / crew_role / crew_skill are cascade-free at the app layer:
 * deleting a member cascades to children that aren't in Convex (no orphans);
 * deleting a role is guarded against any member still referencing it (no stale
 * crewRoleId); deleting a skill only drops m2m links that Convex doesn't store.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id } as any);
}

// ─── Crew members ────────────────────────────────────────────────────────────
export const mirrorCrewMemberCreate = (row: Record<string, unknown>) => create(api.crewMembers.create, row);
export const patchCrewMemberInConvex = (id: string, row: Record<string, unknown>) => patch(api.crewMembers.update, id, row);
export const removeCrewMemberFromConvex = (id: string) => remove(api.crewMembers.remove, id);

// ─── Crew roles ──────────────────────────────────────────────────────────────
export const mirrorCrewRoleCreate = (row: Record<string, unknown>) => create(api.crewRoles.create, row);
export const patchCrewRoleInConvex = (id: string, row: Record<string, unknown>) => patch(api.crewRoles.update, id, row);
export const removeCrewRoleFromConvex = (id: string) => remove(api.crewRoles.remove, id);

// ─── Crew skills (m2m to members stays Prisma-only) ──────────────────────────
export const mirrorCrewSkillCreate = (row: Record<string, unknown>) => create(api.crewSkills.create, row);
export const removeCrewSkillFromConvex = (id: string) => remove(api.crewSkills.remove, id);
