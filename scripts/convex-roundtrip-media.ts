/**
 * Live round-trip for the *_media dual-write + the media-read photo graft.
 *
 * Seeds a fileUpload + a primary PHOTO modelMedia row in Prisma, mirrors them to
 * Convex (exactly as the server actions do), then proves:
 *   1. getPrimaryPhotoMap("model") reads the photo (url/thumbnail) off the Convex
 *      mirror, matching a direct Prisma join — the non-zero path.
 *   2. getModelById (the warehouse scan-path single-model attach) returns the
 *      Convex model whose name matches Prisma.
 *   3. syncMediaForParent reconcile removes a row deleted in Prisma from Convex.
 * Then cleans up everything it created (DB left as found).
 *
 * Needs the JWKS sidecar (every Convex fn is authed). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-media.ts
 */
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { mirrorFileUploadCreate, mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import { getPrimaryPhotoMap } from "@/lib/media-read";
import { getModelById } from "@/lib/models-read";
import { api } from "../convex/_generated/api";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  x ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const convex = await getConvexClient();

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("no organization to anchor the round-trip");
  const orgId = org.id;
  const model = await prisma.model.findFirst({ where: { organizationId: orgId }, select: { id: true, name: true } });
  if (!model) throw new Error("no model to anchor the round-trip");
  const member = await prisma.member.findFirst({ where: { organizationId: orgId }, select: { userId: true } });
  if (!member) throw new Error("no member to anchor the fileUpload uploadedById");

  const fileId = createId();
  const mediaId = createId();
  const url = `https://example.test/${fileId}.jpg`;
  const thumbnailUrl = `https://example.test/${fileId}_t.jpg`;

  console.log("Seeding fileUpload + modelMedia (Prisma + Convex mirror)...");
  const file = await prisma.fileUpload.create({
    data: {
      id: fileId,
      organizationId: orgId,
      fileName: "roundtrip.jpg",
      fileSize: 1234,
      mimeType: "image/jpeg",
      storageKey: `roundtrip/${fileId}.jpg`,
      url,
      thumbnailUrl,
      uploadedById: member.userId,
    },
  });
  await mirrorFileUploadCreate(file as unknown as Record<string, unknown>);

  const media = await prisma.modelMedia.create({
    data: {
      id: mediaId,
      organizationId: orgId,
      modelId: model.id,
      fileId,
      type: "PHOTO",
      isPrimary: true,
      sortOrder: 0,
    },
  });
  await mirrorMediaCreate("model", media as unknown as Record<string, unknown>);

  // 1. Photo graft off the Convex mirror matches the Prisma join.
  const photoMap = await getPrimaryPhotoMap("model", orgId);
  const got = photoMap[model.id];
  check("getPrimaryPhotoMap returns the seeded model's primary photo", !!got, photoMap);
  check("  url matches the Prisma fileUpload", got?.url === url, got);
  check("  thumbnailUrl matches the Prisma fileUpload", got?.thumbnailUrl === thumbnailUrl, got);

  // direct Prisma join for parity
  const prismaJoin = await prisma.modelMedia.findFirst({
    where: { modelId: model.id, type: "PHOTO", isPrimary: true },
    select: { file: { select: { url: true, thumbnailUrl: true } } },
  });
  check(
    "  Convex-sourced photo == direct Prisma join",
    got?.url === prismaJoin?.file?.url && got?.thumbnailUrl === prismaJoin?.file?.thumbnailUrl,
    { got, prismaJoin },
  );

  // 2. Scan-path single-model attach.
  const convexModel = await getModelById(model.id);
  check("getModelById returns the model (scan-path attach) — mirror present", !!convexModel, model.id);
  if (convexModel) check("  model.name matches Prisma", convexModel.name === model.name, { convex: convexModel.name, prisma: model.name });

  // 3. Reconcile removes a Prisma-deleted media row from Convex.
  await prisma.modelMedia.delete({ where: { id: mediaId } });
  await syncMediaForParent("model", orgId, model.id);
  const afterDelete = await convex.query(api.modelMedia.getById, { id: mediaId });
  check("syncMediaForParent removed the deleted row from Convex", afterDelete === null, afterDelete);
  const photoMapAfter = await getPrimaryPhotoMap("model", orgId);
  check("  photo graft no longer returns the deleted model photo", !photoMapAfter[model.id], photoMapAfter[model.id]);

  // Cleanup: fileUpload (Prisma + Convex). modelMedia already deleted + reconciled.
  console.log("Cleaning up...");
  await prisma.fileUpload.delete({ where: { id: fileId } });
  await mirrorFileUploadDelete(fileId);

  console.log(`\nRound-trip: ${pass} passed, ${fail} failed.`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
