import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, getAuthContext, isMemberAuth } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

// Work-or-project RBAC transition (#1243): task reads were gated on `project:read`
// before the `work` resource existed. Any already-issued API key/OAuth scope still
// carries only `project:*` — accept EITHER scope so old keys keep working while new
// grants can be issued against `work` going forward. Same-file, literal-argument
// helpers so scripts/generate-api-registry.mts's local-helper inlining picks up both
// scopePairs (it collects every requireOrgReadFor match, not just the first).
async function requireWorkOrProjectOrgRead(ctx: QueryCtx, orgId: string): Promise<void> {
  try {
    await requireOrgReadFor(ctx, orgId, "work");
  } catch {
    await requireOrgReadFor(ctx, orgId, "project");
  }
}

async function requireWorkOrProjectOrgReadDoc(
  ctx: QueryCtx,
  doc: { organizationId?: string | null } | null,
): Promise<void> {
  try {
    await requireOrgReadDocFor(ctx, doc, "work");
  } catch {
    await requireOrgReadDocFor(ctx, doc, "project");
  }
}

/**
 * Reads for the basic project task list (Convex table "projectTasks"). Writes
 * live in `projectTasksWrites.ts` (browser-direct, RBAC + audit inside Convex).
 * Org-scoped reads accept the service token OR a user token scoped to the same
 * org. Lookups use the cuid (`id`) via by_cuid. See FEATUREDOCS/50.
 */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireWorkOrProjectOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireWorkOrProjectOrgRead(ctx, orgId);
    // by_projectId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    return (await ctx.db
      .query("projectTasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

// ─── Browser-direct composite reads (Phase 3 — replace the getProjectTasks /
// getTaskAssignees server actions). Assignee names come from the Convex users +
// crewMembers mirrors (the deleted action's Prisma user/member seam is gone). ────

/** People a task can be assigned to: org members (users) + crew members. */
export const assignees = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireWorkOrProjectOrgRead(ctx, orgId);
    const members = await ctx.db
      .query("members")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment) — see docs/exceptions.md R-8.3.3
      .collect();
    members.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // Prisma orderBy createdAt asc
    const users: { id: string; name: string; image: string | null }[] = [];
    for (const m of members) {
      const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", m.userId)).first();
      if (u) users.push({ id: u.id, name: u.name, image: u.image ?? null });
    }
    const crewDocs = await ctx.db
      .query("crewMembers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment) — see docs/exceptions.md R-8.3.3
      .collect();
    const crew = crewDocs
      .filter((c) => c.status !== "ARCHIVED")
      .map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    return { users, crew };
  },
});

/**
 * A project's tasks (sorted sortOrder→createdAt) with the assignee join relations the
 * board renders. dueDate is returned as an ISO string (the consumer slices it to
 * YYYY-MM-DD), matching the deleted server action's serialized shape.
 */
export const listByProjectWithRelations = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireWorkOrProjectOrgRead(ctx, orgId);
    const rows = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
    ).filter((t) => t.organizationId === orgId); // by_projectId is global → org re-check
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

    const out = [];
    for (const t of rows) {
      let assigneeUser: { id: string; name: string; image: string | null } | null = null;
      if (t.assigneeUserId) {
        // Only expose the user's name/image if they are a MEMBER of this org (the
        // users mirror is global — gate the join on by_org_user so a stale/foreign
        // assigneeUserId can't leak another org's user; mirrors the assigneeCrew check).
        const member = await ctx.db
          .query("members")
          .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", t.assigneeUserId as string))
          .first();
        if (member) {
          const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", t.assigneeUserId as string)).first();
          assigneeUser = u ? { id: u.id, name: u.name, image: u.image ?? null } : null;
        }
      }
      let assigneeCrew: { id: string; firstName: string; lastName: string } | null = null;
      if (t.assigneeCrewId) {
        const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", t.assigneeCrewId as string)).first();
        // Crew is org-scoped domain data; re-check org before exposing the name.
        assigneeCrew = c && c.organizationId === orgId ? { id: c.id, firstName: c.firstName, lastName: c.lastName } : null;
      }
      out.push({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        status: t.status ?? "TODO",
        priority: t.priority ?? "NORMAL",
        dueDate: t.dueDate != null ? new Date(t.dueDate).toISOString() : null,
        assigneeUserId: t.assigneeUserId ?? null,
        assigneeCrewId: t.assigneeCrewId ?? null,
        assigneeUser,
        assigneeCrew,
        sortOrder: t.sortOrder ?? 0,
      });
    }
    return out;
  },
});

// ─── myOpenTasks — cross-project "my tasks" read (#952 / QW-3) ────────────
// Union of this user's directly-assigned OPEN tasks (by_assigneeUserId_status)
// and their crew-assigned OPEN tasks (by_assigneeCrewId_status, resolved via
// crewMembers.by_userId), de-duped, org-filtered, sorted, and bounded. Mirrors
// dashboardLists.blocking's auth shape (requireOrgReadFor + getAuthContext user
// token) rather than inventing a new one. `by_assigneeUserId_status` and
// `by_assigneeCrewId_status` are GLOBAL indexes (span every org), so every row
// pulled through them is re-checked against `orgId` before use — the
// cross-tenant-read footgun called out in CLAUDE.md.
const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;
const PRIORITY_SORT_WEIGHT: Record<string, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
const MY_OPEN_TASKS_LIMIT = 100;

type MyOpenTaskDoc = {
  id: string;
  organizationId: string;
  // Absent for a personal task (Phase 1, #1243 quick-add with no project).
  projectId?: string;
  title: string;
  status?: string;
  priority?: string;
  dueDate?: number;
  assigneeUserId?: string;
  assigneeCrewId?: string;
};

async function resolveCrewIdsForUser(ctx: QueryCtx, userId: string, orgId: string): Promise<string[]> {
  // by_userId is global — a person can hold crew records in more than one org
  // (or none), so filter to the caller's org before trusting any id.
  const crewLinks = await ctx.db
    .query("crewMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  return crewLinks.filter((c) => c.organizationId === orgId).map((c) => c.id);
}

/**
 * Union across both assignee shapes × both open statuses, de-duped by id (a
 * task is assigned to a user XOR a crew record, never both, but the union
 * itself needs the guard since it's built from several disjoint scans).
 */
async function collectMyOpenTasks(
  ctx: QueryCtx,
  userId: string,
  crewIds: string[],
  orgId: string,
): Promise<Map<string, MyOpenTaskDoc>> {
  const byId = new Map<string, MyOpenTaskDoc>();
  const keep = (r: MyOpenTaskDoc) => {
    if (r.organizationId !== orgId) return; // global index — org re-check
    byId.set(r.id, r);
  };
  for (const status of OPEN_TASK_STATUSES) {
    const userRows = await ctx.db
      .query("projectTasks")
      .withIndex("by_assigneeUserId_status", (q) => q.eq("assigneeUserId", userId).eq("status", status))
      .collect();
    for (const r of userRows) keep(r as unknown as MyOpenTaskDoc);

    for (const crewId of crewIds) {
      const crewRows = await ctx.db
        .query("projectTasks")
        .withIndex("by_assigneeCrewId_status", (q) => q.eq("assigneeCrewId", crewId).eq("status", status))
        .collect();
      for (const r of crewRows) keep(r as unknown as MyOpenTaskDoc);
    }
  }
  return byId;
}

/**
 * Sort: overdue → due asc (undated last) → priority. A single ascending sort
 * on dueDate (undated = +Infinity) already puts overdue tasks first (their
 * due date is the smallest, being in the past) and undated tasks last;
 * priority breaks ties within the same due date.
 */
function sortMyOpenTasks(tasks: MyOpenTaskDoc[]): MyOpenTaskDoc[] {
  return [...tasks].sort((a, b) => {
    const aDue = a.dueDate ?? Infinity;
    const bDue = b.dueDate ?? Infinity;
    if (aDue !== bDue) return aDue - bDue;
    const aPri = PRIORITY_SORT_WEIGHT[a.priority ?? "NORMAL"] ?? 1;
    const bPri = PRIORITY_SORT_WEIGHT[b.priority ?? "NORMAL"] ?? 1;
    return aPri - bPri;
  });
}

/** Per-task project join {projectName, projectNumber} via point-reads. */
async function resolveProjectsFor(
  ctx: QueryCtx,
  tasks: MyOpenTaskDoc[],
): Promise<Map<string, { name: string; projectNumber: string }>> {
  const projectIds = [...new Set(tasks.map((t) => t.projectId).filter((id): id is string => id != null))];
  const projects = new Map<string, { name: string; projectNumber: string }>();
  await Promise.all(
    projectIds.map(async (pid) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique();
      if (p) projects.set(pid, { name: p.name, projectNumber: p.projectNumber });
    }),
  );
  return projects;
}

/** Split out of serializeMyOpenTask (R-3.6) purely to keep that function's complexity down. */
function projectFieldsFor(t: MyOpenTaskDoc, projects: Map<string, { name: string; projectNumber: string }>) {
  const found = t.projectId ? projects.get(t.projectId) : undefined;
  return found ?? { name: "", projectNumber: "" };
}

function serializeMyOpenTask(
  t: MyOpenTaskDoc,
  projects: Map<string, { name: string; projectNumber: string }>,
  now: number,
) {
  const project = projectFieldsFor(t, projects);
  return {
    id: t.id,
    title: t.title,
    status: t.status ?? "TODO",
    priority: t.priority ?? "NORMAL",
    dueDate: t.dueDate ?? null,
    overdue: t.dueDate != null && t.dueDate < now,
    projectId: t.projectId ?? null,
    projectName: project.name,
    projectNumber: project.projectNumber,
    assigneeUserId: t.assigneeUserId ?? null,
    assigneeCrewId: t.assigneeCrewId ?? null,
  };
}

export const myOpenTasks = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireWorkOrProjectOrgRead(ctx, orgId);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: user token required.");
    const userId = auth.userId;

    const crewIds = await resolveCrewIdsForUser(ctx, userId, orgId);
    const byId = await collectMyOpenTasks(ctx, userId, crewIds, orgId);
    const bounded = sortMyOpenTasks([...byId.values()]).slice(0, MY_OPEN_TASKS_LIMIT);
    const projects = await resolveProjectsFor(ctx, bounded);

    return bounded.map((t) => serializeMyOpenTask(t, projects, now));
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  getById: { summary: "Get one project task by id.", danger: "low", mcpTier: 1 },
  listByProject: { summary: "List tasks belonging to one project.", danger: "low", mcpTier: 1 },
  assignees: { summary: "List people (org members + crew) a task can be assigned to.", danger: "low", mcpTier: 2 },
  listByProjectWithRelations: { summary: "List a project's tasks with assignee joins, in list order.", danger: "low", mcpTier: 1 },
  myOpenTasks: { summary: "List the caller's own open (TODO/IN_PROGRESS) tasks across all projects in an org.", danger: "low", mcpTier: 2 },
};
