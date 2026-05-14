import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
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
    const folder = (formData.get("folder") as string) || "misc";
    const entityId = (formData.get("entityId") as string) || "unknown";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

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

    // Create database record
    const fileUpload = await prisma.fileUpload.create({
      data: {
        organizationId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storageKey,
        url,
        thumbnailUrl,
        width,
        height,
        uploadedById: userId,
      },
    });

    return NextResponse.json(fileUpload);
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}
