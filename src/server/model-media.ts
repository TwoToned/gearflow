"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { MediaType } from "@/generated/prisma/client";

export async function addModelMedia(data: {
  modelId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  // Verify model belongs to org
  const model = await prisma.model.findFirst({
    where: { id: data.modelId, organizationId },
  });
  if (!model) throw new Error("Model not found");

  // Verify file belongs to org
  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  // Get max sort order
  const maxSort = await prisma.modelMedia.aggregate({
    where: { modelId: data.modelId },
    _max: { sortOrder: true },
  });

  // Auto-set primary if first photo
  let isPrimary = false;
  if (data.type === "PHOTO") {
    const existingPhotos = await prisma.modelMedia.count({
      where: { modelId: data.modelId, type: "PHOTO" },
    });
    isPrimary = existingPhotos === 0;
  }

  const media = await prisma.modelMedia.create({
    data: {
      organizationId,
      modelId: data.modelId,
      fileId: data.fileId,
      type: data.type,
      displayName: data.displayName,
      isPrimary,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  await mirrorMediaCreate("model", media);

  return serialize(media);
}

export async function removeModelMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.modelMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  const wasPrimary = media.isPrimary;
  const modelId = media.modelId;

  // Delete the join record
  await prisma.modelMedia.delete({ where: { id: mediaId } });

  // Delete file from S3 and database
  try {
    await deleteFromS3(media.file.storageKey);
    if (media.file.thumbnailUrl) {
      const thumbKey = media.file.storageKey.replace(/(\.[^.]+)$/, "_thumb.jpg");
      await deleteFromS3(thumbKey);
    }
  } catch {
    // S3 cleanup is best-effort
  }
  await prisma.fileUpload.delete({ where: { id: media.fileId } });
  await mirrorFileUploadDelete(media.fileId);

  // Promote next photo if deleted was primary
  if (wasPrimary && media.type === "PHOTO") {
    const next = await prisma.modelMedia.findFirst({
      where: { modelId, type: "PHOTO" },
      orderBy: { sortOrder: "asc" },
    });
    if (next) {
      await prisma.modelMedia.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }

  // Reconcile the model's media into Convex (removes the deleted row, upserts
  // the newly-promoted primary).
  await syncMediaForParent("model", organizationId, modelId);
}

export async function setModelPrimaryPhoto(modelId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();

  // Verify ownership
  const media = await prisma.modelMedia.findFirst({
    where: { id: mediaId, modelId, organizationId, type: "PHOTO" },
  });
  if (!media) throw new Error("Media not found");

  // Unset all primary, set the new one
  await prisma.$transaction([
    prisma.modelMedia.updateMany({
      where: { modelId, type: "PHOTO", organizationId },
      data: { isPrimary: false },
    }),
    prisma.modelMedia.update({
      where: { id: mediaId },
      data: { isPrimary: true },
    }),
  ]);

  await syncMediaForParent("model", organizationId, modelId);
}

export async function reorderModelMedia(modelId: string, orderedIds: string[]) {
  const { organizationId } = await getOrgContext();

  // Verify model ownership
  const model = await prisma.model.findFirst({
    where: { id: modelId, organizationId },
  });
  if (!model) throw new Error("Model not found");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.modelMedia.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  await syncMediaForParent("model", organizationId, modelId);
}

export async function getModelMedia(modelId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.modelMedia.findMany({
    where: { modelId, organizationId },
    include: { file: true },
    orderBy: { sortOrder: "asc" },
  });

  return serialize(media);
}
