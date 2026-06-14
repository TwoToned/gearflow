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
    { const __res = await convex.mutation(api.crewAssignments.createIfMissing, toConvexDoc(a) as FunctionArgs<typeof api.crewAssignments.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const shifts = await prisma.crewShift.findMany();
  for (const s of shifts) {
    { const __res = await convex.mutation(api.crewShifts.createIfMissing, toConvexDoc(s) as FunctionArgs<typeof api.crewShifts.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const availability = await prisma.crewAvailability.findMany();
  for (const av of availability) {
    { const __res = await convex.mutation(api.crewAvailabilities.createIfMissing, toConvexDoc(av) as FunctionArgs<typeof api.crewAvailabilities.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const certifications = await prisma.crewCertification.findMany();
  for (const c of certifications) {
    { const __res = await convex.mutation(api.crewCertifications.createIfMissing, toConvexDoc(c) as FunctionArgs<typeof api.crewCertifications.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const timeEntries = await prisma.crewTimeEntry.findMany();
  for (const t of timeEntries) {
    { const __res = await convex.mutation(api.crewTimeEntries.createIfMissing, toConvexDoc(t) as FunctionArgs<typeof api.crewTimeEntries.createIfMissing>); if (__res.created) created++; else skipped++; }
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
