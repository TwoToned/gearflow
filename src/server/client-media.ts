"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { getClientById } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";
import { deleteFromS3 } from "@/lib/storage";
import type { MediaType } from "@/generated/prisma/client";

export async function addClientMedia(data: {
  clientId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const client = await getClientById(data.clientId);
  if (!client || client.organizationId !== organizationId) throw new Error("Client not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.clientMedia.aggregate({
    where: { clientId: data.clientId },
    _max: { sortOrder: true },
  });

  const media = await prisma.clientMedia.create({
    data: {
      organizationId,
      clientId: data.clientId,
      fileId: data.fileId,
      type: data.type || "DOCUMENT",
      displayName: data.displayName,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  return serialize(media);
}

export async function removeClientMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();

  const media = await prisma.clientMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  await prisma.clientMedia.delete({ where: { id: mediaId } });

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
}
