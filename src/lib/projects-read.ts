import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

export type ConvexProject = Doc<"projects">;

export async function getProjectsByOrg(orgId: string): Promise<ConvexProject[]> {
  return await (await getConvexClient()).query(api.projects.list, { orgId });
}

export async function getProjectById(id: string): Promise<ConvexProject | null> {
  return await (await getConvexClient()).query(api.projects.getById, { id });
}

/** Returns the set of projectIds where userId appears as a project manager. */
export async function getProjectIdsForManager(orgId: string, userId: string): Promise<Set<string>> {
  const client = await getConvexClient();
  const entries = await client.query(api.projectManagers.list, { orgId });
  return new Set(entries.filter((e) => e.userId === userId).map((e) => e.projectId));
}
