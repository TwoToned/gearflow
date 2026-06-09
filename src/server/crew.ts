"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewMemberSchema,
  crewRoleSchema,
  crewSkillSchema,
  crewCertificationSchema,
  type CrewMemberFormValues,
  type CrewRoleFormValues,
  type CrewSkillFormValues,
  type CrewCertificationFormValues,
} from "@/lib/validations/crew";
import { logActivity, buildChanges } from "@/lib/activity-log";
import {
  mirrorCrewMemberCreate,
  patchCrewMemberInConvex,
  removeCrewMemberFromConvex,
  mirrorCrewRoleCreate,
  patchCrewRoleInConvex,
  removeCrewRoleFromConvex,
  mirrorCrewSkillCreate,
  removeCrewSkillFromConvex,
} from "@/lib/crew-mirror";
import {
  mirrorCrewCertificationCreate,
  removeCrewCertificationFromConvex,
  snapshotCrewMemberCascade,
  removeCrewMemberCascadeFromConvex,
} from "@/lib/crew-scheduling-mirror";
import { buildFilterWhere, type FilterValue } from "@/lib/table-utils";
import type { ColumnDef } from "@/components/ui/data-table";

// ─── Column defs for server-side filter building ─────────────────────────────

const filterColumnDefs: ColumnDef<unknown>[] = [
  { id: "type", header: "Type", accessorKey: "type", filterable: true, filterType: "enum" },
  { id: "status", header: "Status", accessorKey: "status", filterable: true, filterType: "enum" },
  { id: "department", header: "Department", accessorKey: "department", filterable: true, filterType: "enum" },
];

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

  const filterWhere = filters ? buildFilterWhere(filters, filterColumnDefs) : {};

  const where = {
    organizationId,
    ...filterWhere,
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search, mode: "insensitive" as const } },
            { department: { contains: search, mode: "insensitive" as const } },
            { tags: { hasSome: [search.toLowerCase()] } },
          ],
        }
      : {}),
  };

  const [crewMembers, total] = await Promise.all([
    prisma.crewMember.findMany({
      where,
      include: {
        crewRole: { select: { id: true, name: true, color: true } },
        skills: { select: { id: true, name: true, category: true } },
        user: { select: { id: true, name: true, image: true } },
        _count: { select: { certifications: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.crewMember.count({ where }),
  ]);

  return serialize({ crewMembers, total });
}

export async function getCrewMemberById(id: string) {
  const { organizationId, userId } = await requirePermission("crew", "read");
  const crewMember = await prisma.crewMember.findUnique({
    where: { id, organizationId },
    include: {
      crewRole: true,
      skills: true,
      certifications: {
        orderBy: { expiryDate: "asc" },
      },
      user: { select: { id: true, name: true, email: true, image: true } },
      assignments: {
        include: {
          project: { select: { id: true, name: true, projectNumber: true, status: true } },
          crewRole: { select: { id: true, name: true, color: true } },
        },
        orderBy: { startDate: "desc" },
      },
    },
  });
  if (!crewMember) throw new Error("Crew member not found");
  // Include whether this is the current user's own crew profile
  return serialize({ ...crewMember, isOwnProfile: crewMember.userId === userId });
}

/**
 * Per-crew-member cross-domain extras (memberId -> { user, skills, certCount }).
 * The reactive roster subscribes to the `crewMembers` table via Convex, but a
 * member's linked platform user (Better Auth, Prisma), skills (implicit m2m,
 * Prisma-only), and certification count (crew_certification stays Prisma) are NOT
 * in Convex — they come from this (non-reactive) server query and are merged into
 * the reactive list client-side. crewRole name/color is resolved client-side from
 * the reactive `crewRoles` list instead (it IS in Convex). See FEATUREDOCS/54.
 */
export async function getCrewMemberExtras(): Promise<
  Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[]; certCount: number }>
> {
  const { organizationId } = await requirePermission("crew", "read");
  const members = await prisma.crewMember.findMany({
    where: { organizationId },
    select: {
      id: true,
      user: { select: { name: true, image: true } },
      skills: { select: { id: true, name: true } },
      _count: { select: { certifications: true } },
    },
  });
  const out: Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[]; certCount: number }> = {};
  for (const m of members) {
    out[m.id] = {
      userName: m.user?.name ?? null,
      userImage: m.user?.image ?? null,
      skills: m.skills,
      certCount: m._count.certifications,
    };
  }
  return serialize(out);
}

/** Get the current user's crew member ID (if they have a linked crew profile) */
export async function getMyCrewMemberId() {
  const { organizationId, userId } = await getOrgContext();
  const crewMember = await prisma.crewMember.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  });
  return crewMember?.id ?? null;
}

export async function createCrewMember(data: CrewMemberFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "create");
  const parsed = crewMemberSchema.parse(data);

  const { skillIds, userId: linkUserId, ...rest } = parsed;

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
      ...(skillIds && skillIds.length > 0
        ? { skills: { connect: skillIds.map((id: string) => ({ id })) } }
        : {}),
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
    include: { skills: { select: { id: true } } },
  });
  if (!before) throw new Error("Crew member not found");

  const { skillIds, userId: linkUserId, ...rest } = parsed;

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
      skills: {
        set: (skillIds || []).map((sid: string) => ({ id: sid })),
      },
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
  // time entries, certifications and availability) before the delete removes them.
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
  return serialize(
    await prisma.crewRole.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { crewMembers: true } } },
    })
  );
}

export async function createCrewRole(data: CrewRoleFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "create");
  const parsed = crewRoleSchema.parse(data);
  const result = await prisma.crewRole.create({
    data: {
      ...parsed,
      rateType: parsed.rateType || null,
      defaultRate: parsed.defaultRate ?? null,
      description: parsed.description || null,
      department: parsed.department || null,
      color: parsed.color || null,
      organizationId,
    },
  });
  await mirrorCrewRoleCreate(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_role",
    entityId: result.id,
    entityName: result.name,
    summary: `Created crew role ${result.name}`,
  });

  return serialize(result);
}

export async function updateCrewRole(id: string, data: CrewRoleFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  const parsed = crewRoleSchema.parse(data);
  const updated = await prisma.crewRole.update({
    where: { id, organizationId },
    data: {
      ...parsed,
      rateType: parsed.rateType || null,
      defaultRate: parsed.defaultRate ?? null,
      description: parsed.description || null,
      department: parsed.department || null,
      color: parsed.color || null,
    },
  });
  await patchCrewRoleInConvex(id, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_role",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated crew role ${updated.name}`,
  });

  return serialize(updated);
}

export async function deleteCrewRole(id: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");
  const role = await prisma.crewRole.findUnique({
    where: { id, organizationId },
    include: { _count: { select: { crewMembers: true } } },
  });
  if (!role) throw new Error("Crew role not found");
  if (role._count.crewMembers > 0) {
    throw new Error("Cannot delete a role that is assigned to crew members. Remove the role from all members first.");
  }
  await prisma.crewRole.delete({ where: { id, organizationId } });
  await removeCrewRoleFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_role",
    entityId: id,
    entityName: role.name,
    summary: `Deleted crew role ${role.name}`,
  });

  return { success: true };
}

// ─── Crew Skills ─────────────────────────────────────────────────────────────

export async function getCrewSkills() {
  const { organizationId } = await requirePermission("crew", "read");
  return serialize(
    await prisma.crewSkill.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { crewMembers: true } } },
    })
  );
}

export async function createCrewSkill(data: CrewSkillFormValues) {
  const { organizationId } = await requirePermission("crew", "create");
  const parsed = crewSkillSchema.parse(data);
  const result = await prisma.crewSkill.create({
    data: {
      ...parsed,
      category: parsed.category || null,
      organizationId,
    },
  });
  await mirrorCrewSkillCreate(result);
  return serialize(result);
}

export async function deleteCrewSkill(id: string) {
  const { organizationId } = await requirePermission("crew", "delete");
  await prisma.crewSkill.delete({ where: { id, organizationId } });
  await removeCrewSkillFromConvex(id);
  return { success: true };
}

// ─── Certifications ──────────────────────────────────────────────────────────

export async function addCertification(crewMemberId: string, data: CrewCertificationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  // Verify crew member belongs to this org
  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
  });
  if (!member) throw new Error("Crew member not found");

  const parsed = crewCertificationSchema.parse(data);
  const result = await prisma.crewCertification.create({
    data: {
      ...parsed,
      issuedBy: parsed.issuedBy || null,
      certificateNumber: parsed.certificateNumber || null,
      issuedDate: parsed.issuedDate ? new Date(parsed.issuedDate as unknown as string) : null,
      expiryDate: parsed.expiryDate ? new Date(parsed.expiryDate as unknown as string) : null,
      crewMemberId,
    },
  });

  await mirrorCrewCertificationCreate(result as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Added certification "${parsed.name}" to ${member.firstName} ${member.lastName}`,
  });

  return serialize(result);
}

export async function removeCertification(certId: string) {
  const { organizationId } = await requirePermission("crew", "update");
  const cert = await prisma.crewCertification.findUnique({
    where: { id: certId },
    include: { crewMember: { select: { organizationId: true } } },
  });
  if (!cert || cert.crewMember.organizationId !== organizationId) {
    throw new Error("Certification not found");
  }
  await prisma.crewCertification.delete({ where: { id: certId } });
  await removeCrewCertificationFromConvex(certId);
  return { success: true };
}

// ─── Quick Helpers ───────────────────────────────────────────────────────────

/** Get all crew roles for dropdown options */
export async function getCrewRoleOptions() {
  const { organizationId } = await requirePermission("crew", "read");
  return serialize(
    await prisma.crewRole.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, department: true, color: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
  );
}

/** Get all crew skills for multi-select */
export async function getCrewSkillOptions() {
  const { organizationId } = await requirePermission("crew", "read");
  return serialize(
    await prisma.crewSkill.findMany({
      where: { organizationId },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    })
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

  // Get already-linked user IDs in this org
  const linked = await prisma.crewMember.findMany({
    where: { organizationId, userId: { not: null } },
    select: { userId: true },
  });
  const linkedIds = new Set(linked.map((c) => c.userId));

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
  const results = await prisma.crewMember.findMany({
    where: { organizationId, department: { not: null } },
    select: { department: true },
    distinct: ["department"],
    orderBy: { department: "asc" },
  });
  return results.map((r) => r.department).filter(Boolean) as string[];
}
