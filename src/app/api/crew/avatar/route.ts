import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth-server";
import { readValidatedBody } from "@/lib/api-validation";
import { validateCsrfOrigin } from "@/lib/csrf";
import { uploadToS3, deleteFromS3, ensureBucket, storageKeyFromUrl } from "@/lib/storage";
import { getOrgContext } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import { getCrewMemberById } from "@/lib/crew-read";
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
    const member = await getCrewMemberById(crewMemberId);
    if (!member || member.organizationId !== organizationId) {
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

    await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
      id: crewMemberId,
      set: { image: url, updatedAt: Date.now() },
    });

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
    const parsed = await readValidatedBody(
      request,
      z.object({ crewMemberId: z.string().min(1) }),
    );
    if (!parsed.ok) return parsed.response;
    const { crewMemberId } = parsed.data;

    const member = await getCrewMemberById(crewMemberId);
    if (!member || member.organizationId !== organizationId) {
      return NextResponse.json({ error: "Crew member not found" }, { status: 404 });
    }

    if (member.image) {
      const key = storageKeyFromUrl(member.image);
      if (key) {
        try { await deleteFromS3(key); } catch { /* ignore */ }
      }
    }

    await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
      id: crewMemberId,
      set: { updatedAt: Date.now() },
      clear: ["image"],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Crew avatar delete error:", error);
    return NextResponse.json({ error: "Failed to remove image." }, { status: 500 });
  }
}
