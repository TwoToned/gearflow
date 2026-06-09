/**
 * One-time (re-runnable) backfill: copy the crew SCHEDULING / TIMESHEET sub-tables
 * — crew_assignment, crew_shift, crew_availability, crew_certification,
 * crew_time_entry — from Prisma into Convex.
 *
 * Crew cluster (Phase 3), dual-write infra-only. Idempotent — skips rows already
 * present in Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal ->
 * number, null -> absent. Also the heal path for the dual-write (clears
 * regenerate-orphaned shifts only by a truncate, not here — this script only adds).
 *
 * The roster trio (role/skill/member) is backfilled separately by
 * convex-backfill-crew.ts. See src/lib/crew-scheduling-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-crew-scheduling.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const assignments = await prisma.crewAssignment.findMany();
  for (const a of assignments) {
    if (await convex.query(api.crewAssignments.getById, { id: a.id })) { skipped++; continue; }
    await convex.mutation(api.crewAssignments.create, toConvexDoc(a) as FunctionArgs<typeof api.crewAssignments.create>);
    created++;
  }

  const shifts = await prisma.crewShift.findMany();
  for (const s of shifts) {
    if (await convex.query(api.crewShifts.getById, { id: s.id })) { skipped++; continue; }
    await convex.mutation(api.crewShifts.create, toConvexDoc(s) as FunctionArgs<typeof api.crewShifts.create>);
    created++;
  }

  const availability = await prisma.crewAvailability.findMany();
  for (const av of availability) {
    if (await convex.query(api.crewAvailabilities.getById, { id: av.id })) { skipped++; continue; }
    await convex.mutation(api.crewAvailabilities.create, toConvexDoc(av) as FunctionArgs<typeof api.crewAvailabilities.create>);
    created++;
  }

  const certifications = await prisma.crewCertification.findMany();
  for (const c of certifications) {
    if (await convex.query(api.crewCertifications.getById, { id: c.id })) { skipped++; continue; }
    await convex.mutation(api.crewCertifications.create, toConvexDoc(c) as FunctionArgs<typeof api.crewCertifications.create>);
    created++;
  }

  const timeEntries = await prisma.crewTimeEntry.findMany();
  for (const t of timeEntries) {
    if (await convex.query(api.crewTimeEntries.getById, { id: t.id })) { skipped++; continue; }
    await convex.mutation(api.crewTimeEntries.create, toConvexDoc(t) as FunctionArgs<typeof api.crewTimeEntries.create>);
    created++;
  }

  console.log(
    `Crew scheduling backfill complete: ${created} created, ${skipped} already present ` +
    `(${assignments.length} assignments, ${shifts.length} shifts, ${availability.length} availability, ` +
    `${certifications.length} certifications, ${timeEntries.length} time entries).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
