"use server";

import { getOrgContext } from "@/lib/org-context";
import { getModelById } from "@/lib/models-read";
import { getModelMediaFromConvex } from "@/lib/media-read";
import {
  addMediaConvex,
  removeMediaConvex,
  setPrimaryPhotoConvex,
  reorderMediaConvex,
} from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { MediaType } from "@/generated/prisma/client";

// modelMedia + its file_upload are Convex-only (Phase C). See media-write.ts.

export async function addModelMedia(data: {
  modelId: string;
  fileId: string;
  type: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const model = await getModelById(data.modelId);
  if (!model || model.organizationId !== organizationId) throw new Error("Model not found");

  const media = await addMediaConvex("model", {
    organizationId,
    parentId: data.modelId,
    fileId: data.fileId,
    type: data.type,
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeModelMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("model", { organizationId, mediaId });
}

export async function setModelPrimaryPhoto(modelId: string, mediaId: string) {
  const { organizationId } = await getOrgContext();
  await setPrimaryPhotoConvex("model", { organizationId, parentId: modelId, mediaId });
}

export async function reorderModelMedia(modelId: string, orderedIds: string[]) {
  const { organizationId } = await getOrgContext();
  const model = await getModelById(modelId);
  if (!model || model.organizationId !== organizationId) throw new Error("Model not found");
  await reorderMediaConvex("model", orderedIds);
}

export async function getModelMedia(modelId: string) {
  const { organizationId } = await getOrgContext();
  const media = (await getModelMediaFromConvex(modelId)).filter(
    (m) => m.organizationId === organizationId,
  );
  return serialize(media);
}
