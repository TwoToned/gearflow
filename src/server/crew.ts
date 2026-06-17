"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewMemberSchema,
  type CrewMemberFormValues,
} from "@/lib/validations/crew";
import { logActivity, buildChanges } from "@/lib/activity-log";
import {
  mirrorCrewMemberCreate,
  patchCrewMemberInConvex,
  removeCrewMemberFromConvex,
} from "@/lib/crew-mirror";
import {
  snapshotCrewMemberCascade,
  removeCrewMemberCascadeFromConvex,
} from "@/lib/crew-scheduling-mirror";
import { type FilterValue } from "@/lib/table-utils";
import {
  getCrewMembersByOrg,
  getCrewMemberById as getConvexCrewMemberById,
  getCrewRolesByOrg,
  getCrewSkillsByOrg,
  mapCrewMember,
  mapCrewRole,
  mapCrewSkill,
  applyCrewMemberFilters,
  applyCrewMemberSearch,
  sortCrewMembers,
  paginate,
  distinctDepartments,
  activeRolesSorted,
  skillsSorted,
  countMembersByRole,
} from "@/lib/crew-read";

// ─── Crew Members ────────────────────────────────────────────────────────────

export async function getCrewMembers(params: {
  search?: string;
  filters?: Record<string, FilterValue>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await requirePermission("crew", "read");
  const { search, filters, page = 1, pageSize = 25, sortBy = "lastName", sortOrder = "asc" } = params;

  // Base member rows come from Convex (the reactive mirror). Filter/search/sort/
  // paginate in JS, replicating the Prisma where/orderBy/skip/take.
  const all = (await getCrewMembersByOrg(organizationId)).map(mapCrewMember);
  const filtered = applyCrewMemberSearch(applyCrewMemberFilters(all, filters), search);
  const sorted = sortCrewMembers(filtered, sortBy, sortOrder);
  const total = sorted.length;
  const pageRows = paginate(sorted, page, pageSize);

  // crewRole (id/name/color) resolves from the Convex role map.
  const roleMap = new Map(
    (await getCrewRolesByOrg(organizationId)).map(mapCrewRole).map((r) => [r.id, r] as const),
  );

  // skills (implicit m2m, Prisma-only) and the linked Better Auth user join stay
  // Prisma — batched over just the page's members.
  const pageIds = pageRows.map((m) => m.id);
  const userIds = pageRows.map((m) => m.userId).filter((u): u is string => u != null);
  const [withSkills, users] = await Promise.all([
    pageIds.length
      ? prisma.crewMember.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, skills: { select: { id: true, name: true, category: true } } },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, image: true },
        })
      : Promise.resolve([]),
  ]);
  const skillsByMember = new Map(withSkills.map((m) => [m.id, m.skills]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const crewMembers = pageRows.map((m) => {
    const role = m.crewRoleId ? roleMap.get(m.crewRoleId) : null;
    return {
      ...m,
      crewRole: role ? { id: role.id, name: role.name, color: role.color } : null,
      skills: skillsByMember.get(m.id) ?? [],
      user: m.userId ? userById.get(m.userId) ?? null : null,
    };
  });

  return serialize({ crewMembers, total });
}

export async function getCrewMemberById(id: string) {
  const { organizationId, userId } = await requirePermission("crew", "read");
  const doc = await getConvexCrewMemberById(id);
  // Convex getById is not org-scoped in the query args — enforce org isolation
  // here (matches the Prisma `where: { id, organizationId }`).
  if (!doc || doc.organizationId !== organizationId) throw new Error("Crew member not found");
  const crewMember = mapCrewMember(doc);

  // crewRole (full row) from the Convex role map; skills (m2m), the linked
  // Better Auth user, and project assignments (scheduling sub-table) stay Prisma.
  const [role, prismaExtras] = await Promise.all([
    crewMember.crewRoleId
      ? getCrewRolesByOrg(organizationId).then(
          (roles) => roles.map(mapCrewRole).find((r) => r.id === crewMember.crewRoleId) ?? null,
        )
      : Promise.resolve(null),
    prisma.crewMember.findUnique({
      where: { id, organizationId },
      select: {
        skills: true,
        user: { select: { id: true, name: true, email: true, image: true } },
        assignments: {
          include: {
            project: { select: { id: true, name: true, projectNumber: true, status: true } },
            crewRole: { select: { id: true, name: true, color: true } },
          },
          orderBy: { startDate: "desc" },
        },
      },
    }),
  ]);

  return serialize({
    ...crewMember,
    crewRole: role,
    skills: prismaExtras?.skills ?? [],
    user: prismaExtras?.user ?? null,
    assignments: prismaExtras?.assignments ?? [],
    // Include whether this is the current user's own crew profile
    isOwnProfile: crewMember.userId === userId,
  });
}

/**
 * Per-crew-member cross-domain extras (memberId -> { user, skills }).
 * The reactive roster subscribes to the `crewMembers` table via Convex, but a
 * member's linked platform user (Better Auth, Prisma) and skills (implicit m2m,
 * Prisma-only) are NOT in Convex — they come from this (non-reactive) server query
 * and are merged into the reactive list client-side. crewRole name/color is
 * resolved client-side from the reactive `crewRoles` list instead (it IS in
 * Convex). This action is INTENTIONALLY still Prisma-only: every field it returns
 * is a cross-domain join (Better Auth User + the `_CrewMemberToCrewSkill` m2m)
 * that has no Convex representation — there is nothing here to read from Convex.
 * See FEATUREDOCS/54.
 */
export async function getCrewMemberExtras(): Promise<
  Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[] }>
> {
  const { organizationId } = await requirePermission("crew", "read");
  const members = await prisma.crewMember.findMany({
    where: { organizationId },
    select: {
      id: true,
      user: { select: { name: true, image: true } },
      skills: { select: { id: true, name: true } },
    },
  });
  const out: Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[] }> = {};
  for (const m of members) {
    out[m.id] = {
      userName: m.user?.name ?? null,
      userImage: m.user?.image ?? null,
      skills: m.skills,
    };
  }
  return serialize(out);
}

/** Get the current user's crew member ID (if they have a linked crew profile) */
export async function getMyCrewMemberId() {
  const { organizationId, userId } = await getOrgContext();
  if (!userId) return null;
  const all = await getCrewMembersByOrg(organizationId);
  // Replicates findFirst({ where: { organizationId, userId } }) — list is already
  // org-scoped, so match on userId only.
  const match = all.find((m) => m.userId === userId);
  return match?.id ?? null;
}

export async function createCrewMember(data: CrewMemberFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "create");
  const parsed = crewMemberSchema.parse(data);

  const { userId: linkUserId, ...rest } = parsed;

  const cleaned = {
    firstName: rest.firstName,
    lastName: rest.lastName,
    email: rest.email || null,
    phone: rest.phone || null,
    type: rest.type,
    status: rest.status,
    department: rest.department || null,
    crewRoleId: rest.crewRoleId || null,
    defaultDayRate: rest.defaultDayRate ?? null,
    defaultHourlyRate: rest.defaultHourlyRate ?? null,
    overtimeMultiplier: rest.overtimeMultiplier ?? null,
    currency: rest.currency || null,
    address: rest.address || null,
    addressLatitude: rest.addressLatitude ?? null,
    addressLongitude: rest.addressLongitude ?? null,
    emergencyContactName: rest.emergencyContactName || null,
    emergencyContactPhone: rest.emergencyContactPhone || null,
    dateOfBirth: rest.dateOfBirth ? new Date(rest.dateOfBirth as unknown as string) : null,
    abnOrGst: rest.abnOrGst || null,
    notes: rest.notes || null,
    tags: (rest.tags || []).map((t: string) => t.toLowerCase()),
    userId: linkUserId || null,
  };

  const result = await prisma.crewMember.create({
    data: {
      ...cleaned,
      organizationId,
    },
  });
  await mirrorCrewMemberCreate(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_member",
    entityId: result.id,
    entityName: `${result.firstName} ${result.lastName}`,
    summary: `Created crew member ${result.firstName} ${result.lastName}`,
  });

  return serialize(result);
}

export async function updateCrewMember(id: string, data: CrewMemberFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  const parsed = crewMemberSchema.parse(data);

  const before = await prisma.crewMember.findUnique({
    where: { id, organizationId },
  });
  if (!before) throw new Error("Crew member not found");

  const { userId: linkUserId, ...rest } = parsed;

  const cleaned = {
    firstName: rest.firstName,
    lastName: rest.lastName,
    email: rest.email || null,
    phone: rest.phone || null,
    type: rest.type,
    status: rest.status,
    department: rest.department || null,
    crewRoleId: rest.crewRoleId || null,
    defaultDayRate: rest.defaultDayRate ?? null,
    defaultHourlyRate: rest.defaultHourlyRate ?? null,
    overtimeMultiplier: rest.overtimeMultiplier ?? null,
    currency: rest.currency || null,
    address: rest.address || null,
    addressLatitude: rest.addressLatitude ?? null,
    addressLongitude: rest.addressLongitude ?? null,
    emergencyContactName: rest.emergencyContactName || null,
    emergencyContactPhone: rest.emergencyContactPhone || null,
    dateOfBirth: rest.dateOfBirth ? new Date(rest.dateOfBirth as unknown as string) : null,
    abnOrGst: rest.abnOrGst || null,
    notes: rest.notes || null,
    tags: (rest.tags || []).map((t: string) => t.toLowerCase()),
    userId: linkUserId || null,
  };

  const updated = await prisma.crewMember.update({
    where: { id, organizationId },
    data: {
      ...cleaned,
    },
  });
  await patchCrewMemberInConvex(id, updated);

  const changes = buildChanges(before, updated, [
    "firstName", "lastName", "email", "phone", "type", "status",
    "department", "defaultDayRate", "defaultHourlyRate", "address", "isActive",
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: updated.id,
    entityName: `${updated.firstName} ${updated.lastName}`,
    summary: `Updated crew member ${updated.firstName} ${updated.lastName}`,
    details: changes.length > 0 ? { changes } : undefined,
  });

  return serialize(updated);
}

export async function deleteCrewMember(id: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");
  const member = await prisma.crewMember.findUnique({
    where: { id, organizationId },
  });
  if (!member) throw new Error("Crew member not found");

  // Capture cascade children (assignments → shifts/time-entries, plus standalone
  // time entries and availability) before the delete removes them.
  const cascade = await snapshotCrewMemberCascade(id);

  await prisma.crewMember.delete({ where: { id, organizationId } });
  await removeCrewMemberFromConvex(id);
  await removeCrewMemberCascadeFromConvex(cascade);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_member",
    entityId: id,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Deleted crew member ${member.firstName} ${member.lastName}`,
    details: { deleted: { name: `${member.firstName} ${member.lastName}` } },
  });

  return { success: true };
}

// ─── Crew Roles ──────────────────────────────────────────────────────────────

export async function getCrewRoles() {
  const { organizationId } = await requirePermission("crew", "read");
  const [roles, members] = await Promise.all([
    getCrewRolesByOrg(organizationId).then((r) => r.map(mapCrewRole)),
    getCrewMembersByOrg(organizationId).then((m) => m.map(mapCrewMember)),
  ]);
  // _count.crewMembers is derivable from Convex: members carry crewRoleId.
  const counts = countMembersByRole(members);
  return serialize(
    activeRolesSorted(roles).map((r) => ({
      ...r,
      _count: { crewMembers: counts[r.id] ?? 0 },
    })),
  );
}

// ─── Crew Skills ─────────────────────────────────────────────────────────────

export async function getCrewSkills() {
  const { organizationId } = await requirePermission("crew", "read");
  // Skill rows come from Convex; but _count.crewMembers is the implicit
  // `_CrewMemberToCrewSkill` m2m, which has NO Convex representation — it stays a
  // batched Prisma read (a legit cross-domain terminus, like the User joins).
  const [skills, counted] = await Promise.all([
    getCrewSkillsByOrg(organizationId).then((s) => s.map(mapCrewSkill)),
    prisma.crewSkill.findMany({
      where: { organizationId },
      select: { id: true, _count: { select: { crewMembers: true } } },
    }),
  ]);
  const countById = new Map(counted.map((s) => [s.id, s._count.crewMembers]));
  return serialize(
    skillsSorted(skills).map((s) => ({
      ...s,
      _count: { crewMembers: countById.get(s.id) ?? 0 },
    })),
  );
}

// ─── Quick Helpers ───────────────────────────────────────────────────────────

/** Get all crew roles for dropdown options */
export async function getCrewRoleOptions() {
  const { organizationId } = await requirePermission("crew", "read");
  const roles = (await getCrewRolesByOrg(organizationId)).map(mapCrewRole);
  return serialize(
    activeRolesSorted(roles).map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department,
      color: r.color,
    })),
  );
}

/** Get all crew skills for multi-select */
export async function getCrewSkillOptions() {
  const { organizationId } = await requirePermission("crew", "read");
  const skills = (await getCrewSkillsByOrg(organizationId)).map(mapCrewSkill);
  return serialize(
    skillsSorted(skills).map((s) => ({ id: s.id, name: s.name, category: s.category })),
  );
}

/** Get org users that can be linked to crew members */
export async function getOrgUsersForCrewLink() {
  // Only callers with update access can actually link — guard the picker too
  // so non-managers don't enumerate the member list.
  const { organizationId } = await requirePermission("crew", "update");

  // Get all org members with user info
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });

  // Get already-linked user IDs in this org. The `member` rows above are Better
  // Auth (auth terminus, stays Prisma); only the crew-member→user linkage comes
  // from the Convex roster mirror.
  const linkedIds = new Set(
    (await getCrewMembersByOrg(organizationId))
      .map((c) => c.userId)
      .filter((u): u is string => u != null),
  );

  return serialize(
    members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      alreadyLinked: linkedIds.has(m.user.id),
    }))
  );
}

/** Update crew member profile image */
export async function updateCrewMemberImage(id: string, image: string | null) {
  const { organizationId } = await requirePermission("crew", "update");
  const member = await prisma.crewMember.findUnique({
    where: { id, organizationId },
  });
  if (!member) throw new Error("Crew member not found");

  const updatedImage = await prisma.crewMember.update({
    where: { id, organizationId },
    data: { image },
  });
  await patchCrewMemberInConvex(id, updatedImage);

  return serialize({ success: true, image });
}

/** Link/unlink a crew member to a platform user */
export async function linkCrewMemberToUser(id: string, userId: string | null) {
  const { organizationId, userId: actorId, userName } = await requirePermission("crew", "update");

  const member = await prisma.crewMember.findUnique({
    where: { id, organizationId },
  });
  if (!member) throw new Error("Crew member not found");

  // If linking, verify the user is a member of this org
  if (userId) {
    const orgMember = await prisma.member.findFirst({
      where: { organizationId, userId },
    });
    if (!orgMember) throw new Error("User is not a member of this organization");

    // Check not already linked to another crew member
    const existing = await prisma.crewMember.findFirst({
      where: { organizationId, userId, id: { not: id } },
    });
    if (existing) throw new Error("This user is already linked to another crew member");
  }

  const updated = await prisma.crewMember.update({
    where: { id, organizationId },
    data: { userId: userId || null },
  });
  await patchCrewMemberInConvex(id, updated);

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: id,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: userId
      ? `Linked crew member ${member.firstName} ${member.lastName} to a platform user`
      : `Unlinked crew member ${member.firstName} ${member.lastName} from platform user`,
  });

  return serialize(updated);
}

/** Get distinct departments for filter options */
export async function getCrewDepartments() {
  const { organizationId } = await requirePermission("crew", "read");
  const members = (await getCrewMembersByOrg(organizationId)).map(mapCrewMember);
  return distinctDepartments(members);
}
