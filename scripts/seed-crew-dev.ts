/**
 * Dev seed — crew cluster data for validating the Phase A read-rewiring of
 * `src/server/crew-dashboard.ts` (and future crew-cluster work) against Convex.
 *
 * Creates roles, members, and the project-coupled scheduling sub-tables
 * (assignments across statuses, time entries, shifts, certifications) attached to
 * the existing seed project. Idempotent — keyed off the seed prefix.
 *
 *   npm run seed:crew   (after `npm run seed` so a project exists)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PFX = "CREWSEED";
const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const d = (offsetDays: number) => new Date(now + offsetDays * day);

async function main() {
  console.log("[crew-seed] starting");
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("[crew-seed] no organization");
  const orgId = org.id;

  const project = await prisma.project.findFirst({ where: { organizationId: orgId, isTemplate: false }, orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("[crew-seed] no project — run `npm run seed` first");

  // ── roles ───────────────────────────────────────────────────────────────────
  const roleDefs = [
    { name: `${PFX} Audio Tech`, color: "#3b82f6", sortOrder: 0 },
    { name: `${PFX} Lighting Op`, color: "#f59e0b", sortOrder: 1 },
  ];
  const roles: { id: string; name: string }[] = [];
  for (const r of roleDefs) {
    const existing = await prisma.crewRole.findFirst({ where: { organizationId: orgId, name: r.name } });
    const row = existing ?? (await prisma.crewRole.create({
      data: { organizationId: orgId, name: r.name, color: r.color, sortOrder: r.sortOrder, isActive: true },
    }));
    roles.push({ id: row.id, name: row.name });
  }

  // ── members ─────────────────────────────────────────────────────────────────
  const memberDefs = [
    { firstName: "Ava", lastName: `${PFX}-Stone`, department: "Audio", roleIdx: 0, email: `ava.${PFX.toLowerCase()}@example.com` },
    { firstName: "Ben", lastName: `${PFX}-Lowe`, department: "Lighting", roleIdx: 1, email: `ben.${PFX.toLowerCase()}@example.com` },
    { firstName: "Cara", lastName: `${PFX}-Hill`, department: "Audio", roleIdx: 0, email: `cara.${PFX.toLowerCase()}@example.com` },
  ];
  const members: { id: string; firstName: string; lastName: string }[] = [];
  for (const m of memberDefs) {
    const existing = await prisma.crewMember.findFirst({ where: { organizationId: orgId, lastName: m.lastName } });
    const row = existing ?? (await prisma.crewMember.create({
      data: {
        organizationId: orgId, firstName: m.firstName, lastName: m.lastName, email: m.email,
        department: m.department, type: "FREELANCER", status: "ACTIVE", isActive: true,
        icalEnabled: false, crewRoleId: roles[m.roleIdx].id,
      },
    }));
    members.push({ id: row.id, firstName: row.firstName, lastName: row.lastName });
  }

  // ── assignments (varied statuses) ────────────────────────────────────────────
  const asgDefs = [
    { memberIdx: 0, roleIdx: 0, status: "CONFIRMED", phase: "EVENT", startDate: d(-1), endDate: d(3) },
    { memberIdx: 1, roleIdx: 1, status: "ACCEPTED", phase: "BUMP_IN", startDate: d(0), endDate: null },
    { memberIdx: 2, roleIdx: 0, status: "PENDING", phase: "EVENT", startDate: d(5), endDate: d(7) },
    { memberIdx: 0, roleIdx: 0, status: "OFFERED", phase: "BUMP_OUT", startDate: d(8), endDate: d(9) },
    { memberIdx: 1, roleIdx: 1, status: "CANCELLED", phase: "EVENT", startDate: d(2), endDate: d(4) },
  ];
  const assignments: { id: string; status: string; memberIdx: number }[] = [];
  for (const a of asgDefs) {
    const existing = await prisma.crewAssignment.findFirst({
      where: { organizationId: orgId, projectId: project.id, crewMemberId: members[a.memberIdx].id, status: a.status as never, startDate: a.startDate },
    });
    const row = existing ?? (await prisma.crewAssignment.create({
      data: {
        organizationId: orgId, projectId: project.id, crewMemberId: members[a.memberIdx].id,
        crewRoleId: roles[a.roleIdx].id, status: a.status as never, phase: a.phase as never,
        isProjectManager: false, startDate: a.startDate, endDate: a.endDate,
      },
    }));
    assignments.push({ id: row.id, status: a.status, memberIdx: a.memberIdx });
  }
  const confirmedAsg = assignments.find((a) => a.status === "CONFIRMED")!;

  // ── time entries ──────────────────────────────────────────────────────────────
  const teDefs = [
    { memberIdx: 0, assignmentIdx: 0, date: d(-1), status: "SUBMITTED", totalHours: 8, start: "08:00", end: "16:00" },
    { memberIdx: 1, assignmentIdx: 1, date: d(-2), status: "SUBMITTED", totalHours: 6, start: "09:00", end: "15:00" },
    { memberIdx: 0, assignmentIdx: 0, date: d(-3), status: "APPROVED", totalHours: 7.5, start: "08:00", end: "15:30" },
    { memberIdx: 2, assignmentIdx: null, date: d(-4), status: "APPROVED", totalHours: 5, start: "10:00", end: "15:00" },
    { memberIdx: 0, assignmentIdx: 0, date: d(-30), status: "APPROVED", totalHours: 9, start: "08:00", end: "17:00" },
  ];
  for (const t of teDefs) {
    const existing = await prisma.crewTimeEntry.findFirst({
      where: { organizationId: orgId, crewMemberId: members[t.memberIdx].id, date: t.date },
    });
    if (existing) continue;
    await prisma.crewTimeEntry.create({
      data: {
        organizationId: orgId, crewMemberId: members[t.memberIdx].id,
        assignmentId: t.assignmentIdx != null ? assignments[t.assignmentIdx].id : null,
        date: t.date, startTime: t.start, endTime: t.end, breakMinutes: 30,
        totalHours: t.totalHours, status: t.status as never,
        description: t.assignmentIdx == null ? "General warehouse" : null,
      },
    });
  }

  // ── shifts (on the CONFIRMED assignment) ─────────────────────────────────────
  const shiftDefs = [
    { date: d(1), status: "SCHEDULED", callTime: "08:00", endTime: "16:00" },
    { date: d(2), status: "SCHEDULED", callTime: "08:00", endTime: "16:00" },
    { date: d(3), status: "SCHEDULED", callTime: "09:00", endTime: "17:00" },
    { date: d(-2), status: "SCHEDULED", callTime: "08:00", endTime: "16:00" }, // past → excluded
    { date: d(4), status: "CANCELLED", callTime: "08:00", endTime: "16:00" }, // cancelled → excluded
  ];
  for (const s of shiftDefs) {
    const existing = await prisma.crewShift.findFirst({ where: { assignmentId: confirmedAsg.id, date: s.date } });
    if (existing) continue;
    await prisma.crewShift.create({
      data: { assignmentId: confirmedAsg.id, date: s.date, status: s.status as never, callTime: s.callTime, endTime: s.endTime, breakMinutes: 30 },
    });
  }

  // ── certifications ───────────────────────────────────────────────────────────
  const certDefs = [
    { memberIdx: 0, name: "White Card", status: "CURRENT", expiry: d(300) },
    { memberIdx: 1, name: "EWP Licence", status: "EXPIRING_SOON", expiry: d(20) },
    { memberIdx: 2, name: "Test & Tag Cert", status: "EXPIRED", expiry: d(-10) },
  ];
  for (const c of certDefs) {
    const existing = await prisma.crewCertification.findFirst({ where: { crewMemberId: members[c.memberIdx].id, name: c.name } });
    if (existing) continue;
    await prisma.crewCertification.create({
      data: { crewMemberId: members[c.memberIdx].id, name: c.name, status: c.status as never, expiryDate: c.expiry },
    });
  }

  const counts = {
    roles: await prisma.crewRole.count({ where: { organizationId: orgId } }),
    members: await prisma.crewMember.count({ where: { organizationId: orgId } }),
    assignments: await prisma.crewAssignment.count({ where: { organizationId: orgId } }),
    timeEntries: await prisma.crewTimeEntry.count({ where: { organizationId: orgId } }),
    shifts: await prisma.crewShift.count(),
    certifications: await prisma.crewCertification.count(),
  };
  console.log("[crew-seed] done:", JSON.stringify(counts));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
