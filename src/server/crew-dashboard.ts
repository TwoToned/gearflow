"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";

export async function getCrewPickerList() {
  const { organizationId } = await getOrgContext();

  const members = await prisma.crewMember.findMany({
    where: { organizationId, isActive: true, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      department: true,
      crewRole: { select: { name: true } },
      assignments: {
        where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
        include: {
          project: { select: { id: true, name: true, projectNumber: true } },
          crewRole: { select: { id: true, name: true } },
        },
        orderBy: { startDate: "desc" },
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return serialize(members);
}

export async function getCrewDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    totalActive,
    activeAssignments,
    pendingOffers,
    submittedTime,
    hoursThisWeek,
  ] = await Promise.all([
    prisma.crewMember.count({
      where: { organizationId, isActive: true, status: "ACTIVE" },
    }),
    prisma.crewAssignment.count({
      where: {
        organizationId,
        status: "CONFIRMED",
        OR: [{ endDate: { gte: now } }, { endDate: null }],
      },
    }),
    prisma.crewAssignment.count({
      where: {
        organizationId,
        status: { in: ["PENDING", "OFFERED"] },
      },
    }),
    prisma.crewTimeEntry.count({
      where: { organizationId, status: "SUBMITTED" },
    }),
    prisma.crewTimeEntry.aggregate({
      where: {
        organizationId,
        status: { in: ["APPROVED", "EXPORTED"] },
        date: { gte: weekAgo },
      },
      _sum: { totalHours: true },
    }),
  ]);

  return {
    totalActive,
    activeAssignments,
    pendingOffers,
    submittedTime,
    hoursThisWeek: Number(hoursThisWeek._sum.totalHours || 0),
  };
}

export async function getPendingTimeEntries() {
  const { organizationId } = await getOrgContext();

  const entries = await prisma.crewTimeEntry.findMany({
    where: { organizationId, status: "SUBMITTED" },
    include: {
      crewMember: { select: { firstName: true, lastName: true } },
      assignment: {
        include: {
          project: { select: { name: true, projectNumber: true } },
          crewRole: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
    take: 15,
  });

  return serialize(entries);
}

export async function getActiveAssignmentsSummary() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const assignments = await prisma.crewAssignment.findMany({
    where: {
      organizationId,
      status: { in: ["CONFIRMED", "ACCEPTED"] },
      OR: [{ endDate: { gte: now } }, { endDate: null }],
    },
    include: {
      crewMember: { select: { id: true, firstName: true, lastName: true } },
      crewRole: { select: { name: true } },
      project: {
        select: { id: true, name: true, projectNumber: true, status: true },
      },
    },
    orderBy: { startDate: "asc" },
    take: 20,
  });

  return serialize(assignments);
}

export async function getPendingOffers() {
  const { organizationId } = await getOrgContext();

  const assignments = await prisma.crewAssignment.findMany({
    where: {
      organizationId,
      status: { in: ["PENDING", "OFFERED"] },
    },
    include: {
      crewMember: { select: { id: true, firstName: true, lastName: true, email: true } },
      crewRole: { select: { name: true } },
      project: {
        select: { id: true, name: true, projectNumber: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  return serialize(assignments);
}

export async function getUpcomingShifts() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const shifts = await prisma.crewShift.findMany({
    where: {
      status: "SCHEDULED",
      date: { gte: now },
      assignment: { organizationId },
    },
    include: {
      assignment: {
        include: {
          crewMember: { select: { firstName: true, lastName: true } },
          crewRole: { select: { name: true } },
          project: { select: { name: true, projectNumber: true } },
        },
      },
    },
    orderBy: { date: "asc" },
    take: 10,
  });

  return serialize(shifts);
}
