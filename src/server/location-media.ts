"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import { getOrgContext } from "@/lib/org-context";
import { getLocationById } from "@/lib/locations-read";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { MediaType } from "@/generated/prisma/client";

export async function addLocationMedia(data: {
  locationId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const location = await getLocationById(data.locationId);
  if (!location || location.organizationId !== organizationId) throw new Error("Location not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.locationMedia.aggregate({
    where: { locationId: data.locationId },
    _max: { sortOrder: true },
  });

  const media = await prisma.locationMedia.create({
    data: {
      organizationId,
      locationId: data.locationId,
      fileId: data.fileId,
      type: data.type || "DOCUMENT",
      displayName: data.displayName,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  await mirrorMediaCreate("location", media);

  return serialize(media);
}

export async function removeLocationMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.locationMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  await prisma.locationMedia.delete({ where: { id: mediaId } });

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

  await syncMediaForParent("location", organizationId, media.locationId);
}
