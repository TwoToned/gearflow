"use server";

import { getOrgContext } from "@/lib/org-context";
import { getKitById } from "@/lib/kits-read";
import { getKitMediaFromConvex } from "@/lib/media-read";
import { addMediaConvex, removeMediaConvex, setPrimaryPhotoConvex } from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { MediaType } from "@/generated/prisma/client";

// kitMedia + its file_upload are Convex-only (Phase C). See media-write.ts.

export async function addKitMedia(data: {
  kitId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const kit = await getKitById(data.kitId);
  if (!kit || kit.organizationId !== organizationId) throw new Error("Kit not found");

  const media = await addMediaConvex("kit", {
    organizationId,
    parentId: data.kitId,
    fileId: data.fileId,
    type: data.type,
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeKitMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("kit", { organizationId, mediaId });
}

export async function setKitPrimaryPhoto(kitId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();
  await setPrimaryPhotoConvex("kit", { organizationId, parentId: kitId, mediaId });
}

export async function getKitMedia(kitId: string) {
  const { organizationId } = await getOrgContext();
  const media = (await getKitMediaFromConvex(kitId)).filter(
    (m) => m.organizationId === organizationId,
  );
  return serialize(media);
}
