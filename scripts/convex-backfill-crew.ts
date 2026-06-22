/**
 * One-time (re-runnable) backfill: copy the crew ROSTER tables — crew_role,
 * crew_skill, crew_member — from Prisma into Convex.
 *
 * Crew cluster (Phase 3), dual-write. Idempotent — skips rows already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal -> number, null ->
 * absent. Also the heal path for the dual-write.
 *
 * SCOPE: only the roster trio (role/skill/member) is mirrored — the project-coupled
 * scheduling/timesheet sub-tables (assignment/shift/availability/time_entry)
 * stay Prisma-only until their UIs go reactive. See FEATUREDOCS/54. The implicit
 * m2m `_CrewMemberToCrewSkill` is copied as a `skillIds` array on each member doc
 * (Phase C — crewMember is now Convex-only).
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-crew.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const roles = await prisma.crewRole.findMany();
  for (const r of roles) {
    { const __res = await convex.mutation(api.crewRoles.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.crewRoles.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const skills = await prisma.crewSkill.findMany();
  for (const s of skills) {
    { const __res = await convex.mutation(api.crewSkills.createIfMissing, toConvexDoc(s) as FunctionArgs<typeof api.crewSkills.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const members = await prisma.crewMember.findMany({
    include: { skills: { select: { id: true } } },
  });
  for (const m of members) {
    const { skills: memberSkills, ...scalar } = m;
    { const __res = await convex.mutation(api.crewMembers.createIfMissing, toConvexDoc(scalar) as FunctionArgs<typeof api.crewMembers.createIfMissing>); if (__res.created) created++; else skipped++; }
    // Always patch skillIds (createIfMissing won't update an existing member doc).
    await convex.mutation(api.crewMembers.patchMember, { id: m.id, set: { skillIds: memberSkills.map((s) => s.id) } });
  }

  console.log(
    `Crew roster backfill complete: ${created} created, ${skipped} already present ` +
    `(${roles.length} roles, ${skills.length} skills, ${members.length} members).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
