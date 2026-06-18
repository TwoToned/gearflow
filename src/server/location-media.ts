"use server";

import { getOrgContext } from "@/lib/org-context";
import { getLocationById } from "@/lib/locations-read";
import { addMediaConvex, removeMediaConvex } from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { MediaType } from "@/generated/prisma/client";

// locationMedia + its file_upload are Convex-only (Phase C). See media-write.ts.

export async function addLocationMedia(data: {
  locationId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const location = await getLocationById(data.locationId);
  if (!location || location.organizationId !== organizationId) throw new Error("Location not found");

  const media = await addMediaConvex("location", {
    organizationId,
    parentId: data.locationId,
    fileId: data.fileId,
    type: data.type || "DOCUMENT",
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeLocationMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("location", { organizationId, mediaId });
}
