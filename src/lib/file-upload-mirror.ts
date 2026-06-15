import { type FunctionArgs } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * file_upload is DUAL-WRITTEN: every create/delete writes the Prisma `file_upload`
 * row (the durable FK anchor — all 7 `*_media` tables carry a REQUIRED + Cascade
 * `fileId` FK and stay in Prisma) AND mirrors to the Convex `fileUploads` doc.
 * Prisma is written first; the Convex payload is derived from the written row via
 * toConvexDoc so the two can't drift; the backfill doubles as the heal path.
 *
 * No reactive consumer / Phase-4 hook: media galleries compose fileUpload
 * cross-domain through the `*_media` joins on the always-fresh Prisma mirror, so
 * there is nothing to subscribe to here. These helpers are shared because the
 * file_upload write paths live across 9 files (the uploads API route, org-import,
 * and the 7 `*-media` server actions) rather than one dedicated server module.
 * See FEATUREDOCS/54.
 */

/** Mirror a freshly written Prisma fileUpload row into Convex (create). */
export async function mirrorFileUploadCreate(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.fileUploads.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.fileUploads.createIfMissing>,
  );
}

/** Mirror a fileUpload delete into Convex by cuid. */
export async function mirrorFileUploadDelete(id: string) {
  await (await getConvexClient()).mutation(api.fileUploads.remove, { id });
}
