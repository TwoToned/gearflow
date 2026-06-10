"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { MediaType } from "@/generated/prisma/client";

export async function addKitMedia(data: {
  kitId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const kit = await prisma.kit.findFirst({
    where: { id: data.kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.kitMedia.aggregate({
    where: { kitId: data.kitId },
    _max: { sortOrder: true },
  });

  let isPrimary = false;
  if (data.type === "PHOTO") {
    const existingPhotos = await prisma.kitMedia.count({
      where: { kitId: data.kitId, type: "PHOTO" },
    });
    isPrimary = existingPhotos === 0;
  }

  const media = await prisma.kitMedia.create({
    data: {
      organizationId,
      kitId: data.kitId,
      fileId: data.fileId,
      type: data.type,
      displayName: data.displayName,
      isPrimary,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  await mirrorMediaCreate("kit", media);

  return serialize(media);
}

export async function removeKitMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.kitMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  const wasPrimary = media.isPrimary;
  const kitId = media.kitId;

  await prisma.kitMedia.delete({ where: { id: mediaId } });

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

  if (wasPrimary && media.type === "PHOTO") {
    const next = await prisma.kitMedia.findFirst({
      where: { kitId, type: "PHOTO" },
      orderBy: { sortOrder: "asc" },
    });
    if (next) {
      await prisma.kitMedia.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }

  // Reconcile the kit's media into Convex (removes the deleted row, upserts
  // the newly-promoted primary).
  await syncMediaForParent("kit", organizationId, kitId);
}

export async function setKitPrimaryPhoto(kitId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.kitMedia.findFirst({
    where: { id: mediaId, kitId, organizationId, type: "PHOTO" },
  });
  if (!media) throw new Error("Media not found");

  await prisma.$transaction([
    prisma.kitMedia.updateMany({
      where: { kitId, type: "PHOTO", organizationId },
      data: { isPrimary: false },
    }),
    prisma.kitMedia.update({
      where: { id: mediaId },
      data: { isPrimary: true },
    }),
  ]);

  await syncMediaForParent("kit", organizationId, kitId);
}

export async function getKitMedia(kitId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.kitMedia.findMany({
    where: { kitId, organizationId },
    include: { file: true },
    orderBy: { sortOrder: "asc" },
  });

  return serialize(media);
}
