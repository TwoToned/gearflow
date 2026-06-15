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
