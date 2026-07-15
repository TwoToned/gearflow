import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead, requireOrgPermission, getAuthContext } from "./lib/auth";

/**
 * Browser-native CREW reads (Phase 3 — replaces getCrewMemberById / getCrewMemberExtras
 * / getMyCrewMemberId / getOrgUsersForCrewLink). The roster list + role/skill options are
 * already reactive (useCrewMembers/useCrewRoles), so those server reads were dead and
 * dropped. Linked-user name/image resolve from the Convex `users` mirror (was Prisma).
 * Dates → ISO on the wire.
 */

const iso = (ms: number | null | undefined): string | null => (ms != null ? new Date(ms).toISOString() : null);

async function orgSkillMap(ctx: QueryCtx, orgId: string) {
  const skills = await ctx.db.query("crewSkills").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
  return new Map(skills.map((s) => [s.id, { id: s.id, name: s.name, category: s.category ?? null }]));
}
async function userMirror(ctx: QueryCtx, userId: string | null | undefined) {
  if (!userId) return null;
  const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).unique();
  return u ? { id: u.id, name: u.name, email: u.email, image: u.image ?? null } : null;
}

function mapMember(d: Record<string, unknown>) {
  return {
    id: d.id as string, organizationId: d.organizationId as string, firstName: d.firstName as string, lastName: d.lastName as string,
    email: (d.email as string) ?? null, phone: (d.phone as string) ?? null, image: (d.image as string) ?? null,
    userId: (d.userId as string) ?? null,
    type: ((d.type as string) ?? "FREELANCER") as "EMPLOYEE" | "FREELANCER" | "CONTRACTOR" | "VOLUNTEER",
    status: ((d.status as string) ?? "ACTIVE") as "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "ARCHIVED",
    department: (d.department as string) ?? null, defaultDayRate: (d.defaultDayRate as number) ?? null,
    defaultHourlyRate: (d.defaultHourlyRate as number) ?? null, overtimeMultiplier: (d.overtimeMultiplier as number) ?? null,
    currency: (d.currency as string) ?? null, address: (d.address as string) ?? null,
    addressLatitude: (d.addressLatitude as number) ?? null, addressLongitude: (d.addressLongitude as number) ?? null,
    emergencyContactName: (d.emergencyContactName as string) ?? null, emergencyContactPhone: (d.emergencyContactPhone as string) ?? null,
    dateOfBirth: iso(d.dateOfBirth as number | undefined), abnOrGst: (d.abnOrGst as string) ?? null, notes: (d.notes as string) ?? null,
    tags: (d.tags as string[]) ?? [], icalEnabled: (d.icalEnabled as boolean) ?? false, icalToken: (d.icalToken as string) ?? null,
    crewRoleId: (d.crewRoleId as string) ?? null, createdAt: iso(d.createdAt as number | undefined), updatedAt: iso(d.updatedAt as number | undefined),
    isActive: (d.isActive as boolean) ?? true,
  };
}
function mapRole(d: Record<string, unknown>) {
  return {
    id: d.id as string, organizationId: d.organizationId as string, name: d.name as string, description: (d.description as string) ?? null,
    department: (d.department as string) ?? null, color: (d.color as string) ?? null, defaultRate: (d.defaultRate as number) ?? null,
    rateType: (d.rateType as string) ?? null, sortOrder: (d.sortOrder as number) ?? 0, isActive: (d.isActive as boolean) ?? true,
  };
}

/** Single crew member + role + skills + linked user + assignments(+project/role) + isOwnProfile. */
export const memberDetail = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    // crew:read (membership + permission) — parity with the old getCrewMemberById's
    // requirePermission; requireOrgRead alone would serve crew PII (icalToken/rates/DOB)
    // to a stale-token ex-member or a no-crew-read role (audit). Sibling orgUsersForCrewLink
    // already gates on crew:update.
    await requireOrgPermission(ctx, orgId, "crew", "read");
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) return null;
    const member = mapMember(doc);

    const auth = await getAuthContext(ctx);
    const [roles, skillMap, user] = await Promise.all([
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      orgSkillMap(ctx, orgId),
      userMirror(ctx, member.userId),
    ]);
    const roleById = new Map(roles.map((r) => [r.id, mapRole(r)]));
    const role = member.crewRoleId ? roleById.get(member.crewRoleId) ?? null : null;
    const skills = ((doc.skillIds as string[]) ?? []).map((sid) => skillMap.get(sid)).filter((s): s is { id: string; name: string; category: string | null } => s != null);

    // Assignments for this member (by_crewMemberId, org-filtered, startDate desc NULLS FIRST).
    const assignmentRows = (await ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())
      .filter((a) => a.organizationId === orgId)
      .sort((a, b) => {
        const as = a.startDate, bs = b.startDate;
        if (as == null && bs == null) return 0;
        if (as == null) return -1; // NULLS FIRST (compareDescNullsFirst)
        if (bs == null) return 1;
        return bs - as;
      });
    const projectIds = [...new Set(assignmentRows.map((a) => a.projectId).filter(Boolean))];
    const projById = new Map<string, { id: string; name: string; projectNumber: string; status: string }>();
    for (const pid of projectIds) {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique();
      if (p && p.organizationId === orgId) projById.set(p.id, { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? "" });
    }
    const assignments = assignmentRows.map((a) => {
      const proj = a.projectId ? projById.get(a.projectId) ?? null : null;
      const arole = a.crewRoleId ? roleById.get(a.crewRoleId) : null;
      // Strip the Convex system fields and the single-use offer-respond bearer token
      // (never consumed here) from the wire; ISO every date incl. offer/response stamps (audit).
      const { _id, _creationTime, responseToken, ...rest } = a;
      void _id; void _creationTime; void responseToken;
      return {
        ...rest,
        startDate: iso(a.startDate), endDate: iso(a.endDate), createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
        offeredAt: iso(a.offeredAt), respondedAt: iso(a.respondedAt), confirmedAt: iso(a.confirmedAt),
        project: proj,
        crewRole: arole ? { id: arole.id, name: arole.name, color: arole.color } : null,
      };
    });

    return { ...member, crewRole: role, skills, user, assignments, isOwnProfile: auth?.kind === "user" && member.userId === auth.userId };
  },
});

/** Per-member extras (memberId → { userName, userImage, skills }) — cross-domain joins merged into the reactive roster client-side. */
export const memberExtras = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgPermission(ctx, orgId, "crew", "read"); // parity with getCrewMemberExtras (audit)
    const [members, skillMap] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      orgSkillMap(ctx, orgId),
    ]);
    const out: Record<string, { userName: string | null; userImage: string | null; skills: { id: string; name: string }[] }> = {};
    for (const m of members) {
      const u = await userMirror(ctx, m.userId);
      out[m.id] = {
        userName: u?.name ?? null,
        userImage: u?.image ?? null,
        skills: ((m.skillIds as string[]) ?? []).map((sid) => skillMap.get(sid)).filter((s): s is { id: string; name: string; category: string | null } => s != null).map((s) => ({ id: s.id, name: s.name })),
      };
    }
    return out;
  },
});

/** The caller's own linked crew-member id (or null) — derived from the verified token subject. */
export const myCrewMemberId = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const auth = await getAuthContext(ctx);
    if (!auth || auth.kind !== "user") return null;
    const members = await ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
    return members.find((m) => m.userId === auth.userId)?.id ?? null;
  },
});

/** Org users linkable to a crew member (Better-Auth members + users mirror) + alreadyLinked flag. RBAC crew:update (picker guard). */
export const orgUsersForCrewLink = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgPermission(ctx, orgId, "crew", "update");
    const [members, crew] = await Promise.all([
      ctx.db.query("members").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);
    const linked = new Set(crew.map((c) => c.userId).filter((u): u is string => u != null));
    const out: { id: string; name: string; email: string; image: string | null; alreadyLinked: boolean }[] = [];
    for (const m of members) {
      const u = await userMirror(ctx, m.userId);
      if (!u) continue;
      out.push({ id: u.id, name: u.name, email: u.email, image: u.image, alreadyLinked: linked.has(u.id) });
    }
    return out;
  },
});
