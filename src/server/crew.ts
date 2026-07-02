"use server";

import { type FunctionArgs } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { nativeCrewWrites } from "@/lib/native-writes";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewMemberSchema,
  type CrewMemberFormValues,
} from "@/lib/validations/crew";
import { logActivity, buildChanges } from "@/lib/activity-log";
import { type FilterValue } from "@/lib/table-utils";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getAssignmentsByOrg,
  getTimeEntriesByOrg,
  getAvailabilityByCrewMemberIds,
  compareDescNullsFirst,
} from "@/lib/crew-scheduling-read";
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
  const rawMembers = await getCrewMembersByOrg(organizationId);
  const all = rawMembers.map(mapCrewMember);
  const skillIdsByMember = new Map(rawMembers.map((d) => [d.id, d.skillIds ?? []] as const));
  const filtered = applyCrewMemberSearch(applyCrewMemberFilters(all, filters), search);
  const sorted = sortCrewMembers(filtered, sortBy, sortOrder);
  const total = sorted.length;
  const pageRows = paginate(sorted, page, pageSize);

  // crewRole (id/name/color) resolves from the Convex role map.
  const roleMap = new Map(
    (await getCrewRolesByOrg(organizationId)).map(mapCrewRole).map((r) => [r.id, r] as const),
  );

  // skills resolve from the member's skillIds (Convex) against the org skill map;
  // the linked Better Auth user join stays Prisma (User is a kept table).
  const skillMap = new Map(
    (await getCrewSkillsByOrg(organizationId)).map(
      (s) => [s.id, { id: s.id, name: s.name, category: s.category ?? null }] as const,
    ),
  );
  const userIds = pageRows.map((m) => m.userId).filter((u): u is string => u != null);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const crewMembers = pageRows.map((m) => {
    const role = m.crewRoleId ? roleMap.get(m.crewRoleId) : null;
    return {
      ...m,
      crewRole: role ? { id: role.id, name: role.name, color: role.color } : null,
      skills: (skillIdsByMember.get(m.id) ?? [])
        .map((sid) => skillMap.get(sid))
        .filter((s): s is { id: string; name: string; category: string | null } => s != null),
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
  // crewMember is Convex-only (Phase C): skills from skillIds + the Convex skill
  // map; the linked Better Auth user from Prisma (kept table); assignments from the
  // still-Prisma crewAssignment table with project (Convex) + crewRole (Convex)
  // attached.
  const [roleRows, skillRows, user, allAssignments, projects] = await Promise.all([
    getCrewRolesByOrg(organizationId),
    getCrewSkillsByOrg(organizationId),
    crewMember.userId
      ? prisma.user.findUnique({
          where: { id: crewMember.userId },
          select: { id: true, name: true, email: true, image: true },
        })
      : Promise.resolve(null),
    // Assignments for this member from Convex (org-scoped), startDate desc —
    // replaces the Prisma crewAssignment.findMany.
    getAssignmentsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const assignmentRows = allAssignments
    .filter((a) => a.crewMemberId === id)
    .sort((a, b) => compareDescNullsFirst(a.startDate?.getTime(), b.startDate?.getTime()));

  const role = crewMember.crewRoleId
    ? roleRows.map(mapCrewRole).find((r) => r.id === crewMember.crewRoleId) ?? null
    : null;
  const skillMap = new Map(
    skillRows.map((s) => [s.id, { id: s.id, name: s.name, category: s.category ?? null }] as const),
  );
  const skills = (doc.skillIds ?? [])
    .map((sid) => skillMap.get(sid))
    .filter((s): s is { id: string; name: string; category: string | null } => s != null);
  const roleById = new Map(roleRows.map((r) => [r.id, mapCrewRole(r)] as const));
  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  const assignments = assignmentRows.map((a) => {
    const proj = a.projectId ? projectById.get(a.projectId) : null;
    const arole = a.crewRoleId ? roleById.get(a.crewRoleId) : null;
    return {
      ...a,
      project: proj
        ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber, status: proj.status }
        : null,
      crewRole: arole ? { id: arole.id, name: arole.name, color: arole.color } : null,
    };
  });

  return serialize({
    ...crewMember,
    crewRole: role,
    skills,
    user,
    assignments,
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
  // crewMember is Convex-only (Phase C): skills from skillIds + the Convex skill
  // map; the linked Better Auth user from the kept Prisma table.
  const members = await getCrewMembersByOrg(organizationId);
  const skillMap = new Map(
    (await getCrewSkillsByOrg(organizationId)).map((s) => [s.id, { id: s.id, name: s.name }] as const),
  );
  const userIds = members.map((m) => m.userId).filter((u): u is string => u != null);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const out: Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[] }> = {};
  for (const m of members) {
    const u = m.userId ? userById.get(m.userId) : null;
    out[m.id] = {
      userName: u?.name ?? null,
      userImage: u?.image ?? null,
      skills: (m.skillIds ?? [])
        .map((sid) => skillMap.get(sid))
        .filter((s): s is { id: string; name: string } => s != null),
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

  // crewMember is Convex-only (Phase C). Skills (m2m) are never set on create —
  // they're read-only, backfilled as skillIds. Cascade children stay Prisma.
  const id = createId();
  const now = Date.now();
  const convexDoc = toConvexDoc({ id, organizationId, ...cleaned, isActive: true, createdAt: now, updatedAt: now });
  const convex = await getConvexClient();
  if (nativeCrewWrites()) {
    // Native: insert (idempotent by cuid) + CREATE audit atomic in the mutation.
    await convex.mutation(api.crewWrites.createNative, {
      ...convexDoc,
      actor: { userId, userName },
      auditId: createId(),
    } as FunctionArgs<typeof api.crewWrites.createNative>);
  } else {
    await convex.mutation(
      api.crewMembers.createIfMissing,
      convexDoc as FunctionArgs<typeof api.crewMembers.createIfMissing>,
    );
  }
  const result = {
    id,
    organizationId,
    ...cleaned,
    isActive: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  if (!nativeCrewWrites()) {
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
  }

  return serialize(result);
}

export async function updateCrewMember(id: string, data: CrewMemberFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  const parsed = crewMemberSchema.parse(data);

  const beforeDoc = await getConvexCrewMemberById(id);
  if (!beforeDoc || beforeDoc.organizationId !== organizationId) throw new Error("Crew member not found");
  const before = mapCrewMember(beforeDoc);

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

  // Convex-only patch; null fields are explicitly cleared (removed) via patchMember.
  const now = Date.now();
  const clear = Object.entries(cleaned)
    .filter(([, val]) => val == null)
    .map(([k]) => k);
  const setDoc = toConvexDoc({ ...cleaned, updatedAt: now });
  const updated = { ...before, ...cleaned, updatedAt: new Date(now) };
  const changes = buildChanges(before, updated, [
    "firstName", "lastName", "email", "phone", "type", "status",
    "department", "defaultDayRate", "defaultHourlyRate", "address", "isActive",
  ]);
  const entityName = `${updated.firstName} ${updated.lastName}`;

  const convex = await getConvexClient();
  if (nativeCrewWrites()) {
    // Native: patch/clear + UPDATE audit (with the field-change diff) atomic.
    await convex.mutation(api.crewWrites.updateNative, {
      id,
      orgId: organizationId,
      set: setDoc,
      clear,
      entityName,
      details: changes.length > 0 ? { changes } : undefined,
      actor: { userId, userName },
      auditId: createId(),
      now,
    } as FunctionArgs<typeof api.crewWrites.updateNative>);
  } else {
    await convex.mutation(api.crewMembers.patchMember, { id, set: setDoc, clear });
  }

  if (!nativeCrewWrites()) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "crew_member",
      entityId: updated.id,
      entityName,
      summary: `Updated crew member ${entityName}`,
      details: changes.length > 0 ? { changes } : undefined,
    });
  }

  return serialize(updated);
}

export async function deleteCrewMember(id: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");
  const memberDoc = await getConvexCrewMemberById(id);
  if (!memberDoc || memberDoc.organizationId !== organizationId) throw new Error("Crew member not found");
  const member = mapCrewMember(memberDoc);

  // Cascade children all live in Convex (Convex-only). Delete the member's
  // assignments (each cascades to its shifts + linked time-entries), its standalone
  // time entries, and its availability — replacing the dropped Prisma FK cascade.
  const convex = await getConvexClient();
  const [memberAssignments, orgTimeEntries, memberAvailability] = await Promise.all([
    getAssignmentsByOrg(organizationId).then((rows) => rows.filter((a) => a.crewMemberId === id)),
    getTimeEntriesByOrg(organizationId).then((rows) => rows.filter((t) => t.crewMemberId === id && t.assignmentId == null)),
    getAvailabilityByCrewMemberIds([id]),
  ]);

  // crewMember is Convex-only (Phase C); remove it + cascade its scheduling children.
  if (nativeCrewWrites()) {
    // Native: member-row delete + DELETE audit atomic; the scheduling cascade below
    // stays server-side (same order — member first, then its children).
    await convex.mutation(api.crewWrites.deleteNative, {
      id,
      orgId: organizationId,
      name: `${member.firstName} ${member.lastName}`,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.crewMembers.remove, { id });
  }
  for (const a of memberAssignments) await convex.mutation(api.crewAssignments.deleteCascade, { id: a.id });
  for (const t of orgTimeEntries) await convex.mutation(api.crewTimeEntries.remove, { id: t.id });
  for (const av of memberAvailability) await convex.mutation(api.crewAvailabilities.remove, { id: av.id });

  if (!nativeCrewWrites()) {
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
  }

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
  // crewMembers per skill now tallied from the members' skillIds (Convex).
  const [skills, members] = await Promise.all([
    getCrewSkillsByOrg(organizationId).then((s) => s.map(mapCrewSkill)),
    getCrewMembersByOrg(organizationId),
  ]);
  const countById = new Map<string, number>();
  for (const m of members) {
    for (const sid of m.skillIds ?? []) countById.set(sid, (countById.get(sid) ?? 0) + 1);
  }
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
  const member = await getConvexCrewMemberById(id);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  // Convex-only; image=null clears the field (removed via patchMember).
  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id,
    set: image ? { image, updatedAt: Date.now() } : { updatedAt: Date.now() },
    clear: image ? [] : ["image"],
  });

  return serialize({ success: true, image });
}

/** Link/unlink a crew member to a platform user */
export async function linkCrewMemberToUser(id: string, userId: string | null) {
  const { organizationId, userId: actorId, userName } = await requirePermission("crew", "update");

  const member = await getConvexCrewMemberById(id);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  // If linking, verify the user is a member of this org (Better Auth member — Prisma)
  if (userId) {
    const orgMember = await prisma.member.findFirst({
      where: { organizationId, userId },
    });
    if (!orgMember) throw new Error("User is not a member of this organization");

    // Check not already linked to another crew member (Convex roster)
    const existing = (await getCrewMembersByOrg(organizationId)).find(
      (m) => m.userId === userId && m.id !== id,
    );
    if (existing) throw new Error("This user is already linked to another crew member");
  }

  // Convex-only; unlink (userId=null) clears the field via patchMember.
  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id,
    set: userId ? { userId, updatedAt: Date.now() } : { updatedAt: Date.now() },
    clear: userId ? [] : ["userId"],
  });

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

  return serialize({ ...mapCrewMember(member), userId: userId || null });
}

/** Get distinct departments for filter options */
export async function getCrewDepartments() {
  const { organizationId } = await requirePermission("crew", "read");
  const members = (await getCrewMembersByOrg(organizationId)).map(mapCrewMember);
  return distinctDepartments(members);
}
