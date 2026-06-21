"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import { getOrgContext } from "@/lib/org-context";
import { getAssetById } from "@/lib/assets-read";
import { getAssetMediaFromConvex } from "@/lib/media-read";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { MediaType } from "@/generated/prisma/client";

export async function addAssetMedia(data: {
  assetId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const asset = await getAssetById(data.assetId);
  if (!asset || asset.organizationId !== organizationId) throw new Error("Asset not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.assetMedia.aggregate({
    where: { assetId: data.assetId },
    _max: { sortOrder: true },
  });

  let isPrimary = false;
  if (data.type === "PHOTO") {
    const existingPhotos = await prisma.assetMedia.count({
      where: { assetId: data.assetId, type: "PHOTO" },
    });
    isPrimary = existingPhotos === 0;
  }

  const media = await prisma.assetMedia.create({
    data: {
      organizationId,
      assetId: data.assetId,
      fileId: data.fileId,
      type: data.type,
      displayName: data.displayName,
      isPrimary,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  await mirrorMediaCreate("asset", media);

  return serialize(media);
}

export async function removeAssetMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.assetMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  const wasPrimary = media.isPrimary;
  const assetId = media.assetId;

  await prisma.assetMedia.delete({ where: { id: mediaId } });

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
    const next = await prisma.assetMedia.findFirst({
      where: { assetId, type: "PHOTO" },
      orderBy: { sortOrder: "asc" },
    });
    if (next) {
      await prisma.assetMedia.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }

  // Reconcile the asset's media into Convex (removes the deleted row, upserts
  // the newly-promoted primary).
  await syncMediaForParent("asset", organizationId, assetId);
}

export async function setAssetPrimaryPhoto(assetId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.assetMedia.findFirst({
    where: { id: mediaId, assetId, organizationId, type: "PHOTO" },
  });
  if (!media) throw new Error("Media not found");

  await prisma.$transaction([
    prisma.assetMedia.updateMany({
      where: { assetId, type: "PHOTO", organizationId },
      data: { isPrimary: false },
    }),
    prisma.assetMedia.update({
      where: { id: mediaId },
      data: { isPrimary: true },
    }),
  ]);

  await syncMediaForParent("asset", organizationId, assetId);
}

export async function getAssetMedia(assetId: string) {
  const { organizationId } = await getOrgContext();

  // Read the gallery from the Convex mirror (dual-written, backfilled). The
  // parent asset is org-unique, but keep the org filter for parity with the
  // old Prisma `where: { assetId, organizationId }`. See media-read.ts.
  const media = (await getAssetMediaFromConvex(assetId)).filter(
    (m) => m.organizationId === organizationId,
  );

  return serialize(media);
}
