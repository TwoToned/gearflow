"use server";

import { getOrgContext } from "@/lib/org-context";
import { getClientById } from "@/lib/clients-read";
import { addMediaConvex, removeMediaConvex } from "@/lib/media-write";
import { serialize } from "@/lib/serialize";
import type { MediaType } from "@/generated/prisma/client";

// clientMedia + its file_upload are Convex-only (Phase C). See media-write.ts.

export async function addClientMedia(data: {
  clientId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await getOrgContext();

  const client = await getClientById(data.clientId);
  if (!client || client.organizationId !== organizationId) throw new Error("Client not found");

  const media = await addMediaConvex("client", {
    organizationId,
    parentId: data.clientId,
    fileId: data.fileId,
    type: data.type || "DOCUMENT",
    displayName: data.displayName,
  });
  return serialize(media);
}

export async function removeClientMedia(mediaId: string) {
  const { organizationId } = await getOrgContext();
  await removeMediaConvex("client", { organizationId, mediaId });
}
