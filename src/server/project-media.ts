"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { ProjectMediaType } from "@/generated/prisma/client";

export async function addProjectMedia(data: {
  projectId: string;
  fileId: string;
  type: ProjectMediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findFirst({
    where: { id: data.projectId, organizationId },
  });
  if (!project) throw new Error("Project not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.projectMedia.aggregate({
    where: { projectId: data.projectId },
    _max: { sortOrder: true },
  });

  const media = await prisma.projectMedia.create({
    data: {
      organizationId,
      projectId: data.projectId,
      fileId: data.fileId,
      type: data.type,
      displayName: data.displayName,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  return serialize(media);
}

export async function removeProjectMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.projectMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  await prisma.projectMedia.delete({ where: { id: mediaId } });

  try {
    await deleteFromS3(media.file.storageKey);
    if (media.file.thumbnailUrl) {
      const thumbKey = media.file.storageKey.replace(/(\.[^.]+)$/, "_thumb.jpg");
      await deleteFromS3(thumbKey);
    }
  } catch {
    // Best-effort cleanup
  }
  await prisma.fileUpload.delete({ where: { id: media.fileId } });
  await mirrorFileUploadDelete(media.fileId);
}

export async function getProjectMedia(projectId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.projectMedia.findMany({
    where: { projectId, organizationId },
    include: { file: true },
    orderBy: { sortOrder: "asc" },
  });

  return serialize(media);
}
