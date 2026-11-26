import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { type FunctionArgs } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { requireOrganization } from "@/lib/auth-server";
import { requirePermission } from "@/lib/org-context";
import { CREW_DOCUMENTS_FOLDER } from "../../../../convex/lib/crewDocumentCore";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import { uploadToS3, ensureBucket } from "@/lib/storage";
import { generateThumbnail, isImageMimeType, thumbExtension } from "@/lib/thumbnails";
import { fileTypeFromBuffer } from "file-type";
import { env } from "@/env";

export const runtime = "nodejs";

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Other
  "application/dxf",
  "application/dwg",
  "text/plain",
]);

/** `purpose` is validated, never trusted as free text (R-8.2.3). Absent = an ordinary upload. */
const uploadPurposeSchema = z.enum(["crew-document"]).optional();
const CREW_DOCUMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const MAX_SIZE_MB = env.UPLOAD_MAX_SIZE_MB;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export async function POST(request: NextRequest) {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;
  const userId = session.session.user.id;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const entityId = (formData.get("entityId") as string) || "unknown";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // `purpose: "crew-document"` is the ONLY way into the reserved crew-documents folder (identity
    // material, served by its own gated route). It needs crew:update and takes PDFs and images only; a
    // client naming that folder directly is refused, so no other upload can be made to look like one.
    const purpose = uploadPurposeSchema.safeParse(formData.get("purpose") ?? undefined);
    if (!purpose.success) return NextResponse.json({ error: "Unknown upload purpose." }, { status: 400 });
    const isCrewDocument = purpose.data === "crew-document";
    const requestedFolder = (formData.get("folder") as string) || "misc";
    if (requestedFolder === CREW_DOCUMENTS_FOLDER && !isCrewDocument) {
      return NextResponse.json({ error: "That folder is reserved." }, { status: 400 });
    }
    if (isCrewDocument) {
      try {
        await requirePermission("crew", "update");
      } catch {
        return NextResponse.json({ error: "You don't have permission to upload crew documents." }, { status: 403 });
      }
      if (!CREW_DOCUMENT_MIME_TYPES.has(file.type)) {
        return NextResponse.json({ error: "Crew documents must be a PDF or an image." }, { status: 400 });
      }
    }
    const folder = isCrewDocument ? CREW_DOCUMENTS_FOLDER : requestedFolder;

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_SIZE_MB}MB.` },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type "${file.type}" is not allowed.` },
        { status: 400 }
      );
    }

    await ensureBucket();

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate actual file content via magic bytes (defense against Content-Type spoofing)
    const detected = await fileTypeFromBuffer(buffer);
    if (detected && !ALLOWED_MIME_TYPES.has(detected.mime)) {
      return NextResponse.json(
        { error: `Detected file type "${detected.mime}" is not allowed.` },
        { status: 400 }
      );
    }

    // Upload original
    const { storageKey, url } = await uploadToS3(buffer, {
      organizationId,
      folder,
      entityId,
      fileName: file.name,
      mimeType: file.type,
    });

    // Generate and upload thumbnail for images
    let thumbnailUrl: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    if (isImageMimeType(file.type)) {
      const thumbResult = await generateThumbnail(buffer, file.type);
      if (thumbResult) {
        width = thumbResult.originalWidth;
        height = thumbResult.originalHeight;

        const ext = thumbExtension(thumbResult.thumbnailMimeType);
        const thumbUpload = await uploadToS3(thumbResult.thumbnail, {
          organizationId,
          folder,
          entityId,
          fileName: file.name.replace(/(\.[^.]+)$/, `_thumb${ext}`),
          mimeType: thumbResult.thumbnailMimeType,
        });
        thumbnailUrl = thumbUpload.url;
      }
    }

    // Create the file record (Convex-only since Phase C).
    const now = Date.now();
    const fileUpload = {
      id: createId(),
      organizationId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      storageKey,
      url,
      thumbnailUrl: thumbnailUrl ?? null,
      width: width ?? null,
      height: height ?? null,
      uploadedById: userId,
      createdAt: now,
      updatedAt: now,
    };
    await (await getConvexClient()).mutation(
      api.fileUploads.createIfMissing,
      toConvexDoc(fileUpload) as FunctionArgs<typeof api.fileUploads.createIfMissing>,
    );

    return NextResponse.json(fileUpload);
  } catch (error) {
    logger.error("Upload error", { error: error });
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}
