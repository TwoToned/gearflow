import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Dual-write for the project sub-tables `projectService`, `projectTask`, and
 * `projectManager` (Phase 4 — reactive). These power the services panel, tasks
 * panel, and PM avatars, all of which now subscribe to Convex for cross-tab sync.
 *
 * Strategy: AUTHORITATIVE per-project reconcile, not per-row mirroring. Each has
 * many scattered write sites (services especially — generate/clone create rows in
 * bulk inside transactions), so after any mutating server action we re-read ALL
 * of the project's rows from Prisma and reconcile Convex to match: upsert every
 * Prisma row, delete any Convex row whose id is no longer in Prisma. One call per
 * action covers create/update/delete/bulk/generate uniformly. Same shape as
 * `upsertProjectLineItemsToConvex` + the media mirror's per-parent reconcile.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on re-sync.
 * See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutRef = FunctionReference<"mutation", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryRef = FunctionReference<"query", "public", any, any>;

const RELATION_KEYS = new Set([
  "project", "organization", "crewRole", "crewAssignments", "lineItem",
  "user", "assignee", "assigneeUser", "assigneeCrew", "createdBy", "_count",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

/**
 * Reconcile one project's rows for a given sub-table: upsert each Prisma row,
 * delete Convex rows no longer present. `listByProject`/`create`/`update`/`remove`
 * are the generated CRUD refs for the table.
 */
async function reconcile(
  refs: { listByProject: QueryRef; getById: QueryRef; create: MutRef; update: MutRef; remove: MutRef },
  orgId: string,
  projectId: string,
  prismaRows: Array<Record<string, unknown>>,
) {
  const convex = await getConvexClient();
  const convexRows = (await convex.query(refs.listByProject, { projectId, orgId })) as Array<{ id: string }>;
  const prismaIds = new Set(prismaRows.map((r) => r.id as string));

  for (const row of prismaRows) {
    const id = row.id as string;
    const existing = await convex.query(refs.getById, { id });
    if (existing) {
      const { id: _id, ...patch } = toConvexDoc(strip(row));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await convex.mutation(refs.update, { id, patch } as any);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await convex.mutation(refs.create, toConvexDoc(strip(row)) as any);
    }
  }
  for (const c of convexRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!prismaIds.has(c.id)) await convex.mutation(refs.remove, { id: c.id } as any);
  }
}

export async function syncProjectServicesToConvex(orgId: string, projectId: string) {
  const rows = await prisma.projectService.findMany({ where: { projectId } });
  await reconcile(
    {
      listByProject: api.projectServices.listByProject,
      getById: api.projectServices.getById,
      create: api.projectServices.create,
      update: api.projectServices.update,
      remove: api.projectServices.remove,
    },
    orgId,
    projectId,
    rows as unknown as Array<Record<string, unknown>>,
  );
}

export async function syncProjectTasksToConvex(orgId: string, projectId: string) {
  const rows = await prisma.projectTask.findMany({ where: { projectId } });
  await reconcile(
    {
      listByProject: api.projectTasks.listByProject,
      getById: api.projectTasks.getById,
      create: api.projectTasks.create,
      update: api.projectTasks.update,
      remove: api.projectTasks.remove,
    },
    orgId,
    projectId,
    rows as unknown as Array<Record<string, unknown>>,
  );
}

export async function syncProjectManagersToConvex(orgId: string, projectId: string) {
  const rows = await prisma.projectManager.findMany({ where: { projectId } });
  await reconcile(
    {
      listByProject: api.projectManagers.listByProject,
      getById: api.projectManagers.getById,
      create: api.projectManagers.create,
      update: api.projectManagers.update,
      remove: api.projectManagers.remove,
    },
    orgId,
    projectId,
    rows as unknown as Array<Record<string, unknown>>,
  );
}
