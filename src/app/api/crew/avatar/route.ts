import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { uploadToS3, deleteFromS3, ensureBucket, storageKeyFromUrl } from "@/lib/storage";
import { getOrgContext } from "@/lib/org-context";
import { patchCrewMemberInConvex } from "@/lib/crew-mirror";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 256;

export async function POST(request: NextRequest) {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await getOrgContext();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const crewMemberId = formData.get("crewMemberId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!crewMemberId) {
      return NextResponse.json({ error: "No crew member ID provided" }, { status: 400 });
    }

    // Verify crew member belongs to this org
    const member = await prisma.crewMember.findUnique({
      where: { id: crewMemberId, organizationId },
      select: { id: true, image: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Crew member not found" }, { status: 404 });
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

    // Delete old image if exists
    if (member.image) {
      const oldKey = storageKeyFromUrl(member.image);
      if (oldKey) {
        try { await deleteFromS3(oldKey); } catch { /* ignore */ }
      }
    }

    const { url } = await uploadToS3(resized, {
      organizationId,
      folder: "crew",
      entityId: crewMemberId,
      fileName: "avatar.jpg",
      mimeType: "image/jpeg",
    });

    await prisma.crewMember.update({
      where: { id: crewMemberId, organizationId },
      data: { image: url },
    });
    await patchCrewMemberInConvex(crewMemberId, { image: url });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Crew avatar upload error:", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const csrfError = validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await getOrgContext();

  try {
    const { crewMemberId } = await request.json();

    if (!crewMemberId) {
      return NextResponse.json({ error: "No crew member ID provided" }, { status: 400 });
    }

    const member = await prisma.crewMember.findUnique({
      where: { id: crewMemberId, organizationId },
      select: { id: true, image: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Crew member not found" }, { status: 404 });
    }

    if (member.image) {
      const key = storageKeyFromUrl(member.image);
      if (key) {
        try { await deleteFromS3(key); } catch { /* ignore */ }
      }
    }

    await prisma.crewMember.update({
      where: { id: crewMemberId, organizationId },
      data: { image: null },
    });
    await patchCrewMemberInConvex(crewMemberId, { image: null });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Crew avatar delete error:", error);
    return NextResponse.json({ error: "Failed to remove image." }, { status: 500 });
  }
}
