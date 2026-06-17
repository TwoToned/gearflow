import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the crew roster (Phase 3 cutover).
 *
 * crew_member / crew_role / crew_skill are dual-written (Prisma FK anchor + Convex
 * reactive doc — see src/lib/crew-mirror.ts). Reads that want the Convex copy go
 * through these helpers; cross-domain joins onto crew (e.g. assignment → member,
 * which still live in Prisma) attach via the maps. The project-coupled crew
 * sub-tables stay Prisma-only for now. See FEATUREDOCS/54.
 */
export type ConvexCrewMember = Doc<"crewMembers">;
export type ConvexCrewRole = Doc<"crewRoles">;
export type ConvexCrewSkill = Doc<"crewSkills">;

export async function getCrewMemberById(id: string): Promise<ConvexCrewMember | null> {
  return await (await getConvexClient()).query(api.crewMembers.getById, { id });
}

export async function getCrewMembersByOrg(orgId: string): Promise<ConvexCrewMember[]> {
  return await (await getConvexClient()).query(api.crewMembers.list, { orgId });
}

export async function getCrewRolesByOrg(orgId: string): Promise<ConvexCrewRole[]> {
  return await (await getConvexClient()).query(api.crewRoles.list, { orgId });
}

export async function getCrewSkillsByOrg(orgId: string): Promise<ConvexCrewSkill[]> {
  return await (await getConvexClient()).query(api.crewSkills.list, { orgId });
}

/** All of an org's crew members keyed by cuid `id`, for attaching to joined rows. */
export async function getCrewMemberMap(orgId: string): Promise<Map<string, ConvexCrewMember>> {
  const all = await getCrewMembersByOrg(orgId);
  return new Map(all.map((m) => [m.id, m]));
}

/** All of an org's crew roles keyed by cuid `id`. */
export async function getCrewRoleMap(orgId: string): Promise<Map<string, ConvexCrewRole>> {
  const all = await getCrewRolesByOrg(orgId);
  return new Map(all.map((r) => [r.id, r]));
}

/**
 * Count of ACTIVE crew members. Replicates Prisma
 * `count({ status: "ACTIVE" })`. A row with no status never matches.
 */
export function countActiveCrew(members: ConvexCrewMember[]): number {
  return members.filter((m) => m.status === "ACTIVE").length;
}
