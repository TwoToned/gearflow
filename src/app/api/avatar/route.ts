import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { mirrorUserToConvex } from "@/lib/user-mirror";
import { uploadToS3, deleteFromS3, ensureBucket, storageKeyFromUrl } from "@/lib/storage";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 256;

export async function POST(request: NextRequest) {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 5MB." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, and WebP images allowed." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate magic bytes
    const detected = await fileTypeFromBuffer(buffer);
    if (detected && !ALLOWED_TYPES.has(detected.mime)) {
      return NextResponse.json({ error: `Detected type "${detected.mime}" not allowed.` }, { status: 400 });
    }

    // Resize to 256x256 square
    const resized = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .jpeg({ quality: 85 })
      .toBuffer();

    await ensureBucket();

    // Delete old avatar if exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    if (user?.image) {
      const oldKey = storageKeyFromUrl(user.image);
      if (oldKey) {
        try { await deleteFromS3(oldKey); } catch { /* ignore */ }
      }
    }

    // Upload under global avatars/ prefix (not org-scoped)
    const { url } = await uploadToS3(resized, {
      organizationId: "avatars",
      folder: "users",
      entityId: userId,
      fileName: "avatar.jpg",
      mimeType: "image/jpeg",
    });

    // Update user record
    await prisma.user.update({
      where: { id: userId },
      data: { image: url },
    });
    await mirrorUserToConvex(userId); // keep the Convex user mirror in sync

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Avatar upload error:", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    if (user?.image) {
      const key = storageKeyFromUrl(user.image);
      if (key) {
        try { await deleteFromS3(key); } catch { /* ignore */ }
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { image: null },
    });
    await mirrorUserToConvex(userId); // keep the Convex user mirror in sync

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Avatar delete error:", error);
    return NextResponse.json({ error: "Failed to remove avatar." }, { status: 500 });
  }
}
