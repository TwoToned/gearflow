"use server";

import { getOrgContext } from "@/lib/org-context";
import { getProjectById } from "@/lib/projects-read";
import { getProjectMediaFromConvex } from "@/lib/media-read";
import { addMediaConvex, removeMediaConvex } from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { ProjectMediaType } from "@/generated/prisma/client";

// projectMedia + its file_upload are Convex-only (Phase C). See media-write.ts.

export async function addProjectMedia(data: {
  projectId: string;
  fileId: string;
  type: ProjectMediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const project = await getProjectById(data.projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  const media = await addMediaConvex("project", {
    organizationId,
    parentId: data.projectId,
    fileId: data.fileId,
    type: data.type,
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeProjectMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("project", { organizationId, mediaId });
}

export async function getProjectMedia(projectId: string) {
  const { organizationId } = await getOrgContext();
  const media = (await getProjectMediaFromConvex(projectId)).filter(
    (m) => m.organizationId === organizationId,
  );
  return serialize(media);
}
