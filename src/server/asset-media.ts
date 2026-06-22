"use server";

import { getOrgContext } from "@/lib/org-context";
import { getAssetById } from "@/lib/assets-read";
import { getAssetMediaFromConvex } from "@/lib/media-read";
import { addMediaConvex, removeMediaConvex, setPrimaryPhotoConvex } from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { MediaType } from "@/generated/prisma/client";

// assetMedia + its file_upload are Convex-only (Phase C). The single-primary /
// promote-next / sortOrder invariants live in media-write.ts. See FEATUREDOCS/54.

export async function addAssetMedia(data: {
  assetId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const asset = await getAssetById(data.assetId);
  if (!asset || asset.organizationId !== organizationId) throw new Error("Asset not found");

  const media = await addMediaConvex("asset", {
    organizationId,
    parentId: data.assetId,
    fileId: data.fileId,
    type: data.type,
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeAssetMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("asset", { organizationId, mediaId });
}

export async function setAssetPrimaryPhoto(assetId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();
  await setPrimaryPhotoConvex("asset", { organizationId, parentId: assetId, mediaId });
}

export async function getAssetMedia(assetId: string) {
  const { organizationId } = await getOrgContext();
  const media = (await getAssetMediaFromConvex(assetId)).filter(
    (m) => m.organizationId === organizationId,
  );
  return serialize(media);
}
