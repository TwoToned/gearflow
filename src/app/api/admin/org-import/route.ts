import { NextRequest, NextResponse } from "next/server";
import { requireSiteAdminApi } from "@/lib/admin-auth";
import { validateCsrfOrigin } from "@/lib/csrf";
import { importOrganization } from "@/lib/org-import";
import { invalidateOrgCache } from "@/lib/single-org";

export async function POST(req: NextRequest) {
  const csrfError = validateCsrfOrigin(req);
  if (csrfError) return csrfError;

  try {
    const { userId } = await requireSiteAdminApi();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const newOrgName = formData.get("name") as string | null;
    const newOrgSlug = formData.get("slug") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Enforce ZIP file size limit
    const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB
    if (file.size > MAX_ZIP_SIZE) {
      return NextResponse.json(
        { error: `ZIP file too large. Maximum size is ${MAX_ZIP_SIZE / 1024 / 1024}MB.` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await importOrganization(buffer, {
      newOrgName: newOrgName || undefined,
      newOrgSlug: newOrgSlug || undefined,
      importedByUserId: userId,
    });

    // Invalidate the cached org so the new org is picked up
    invalidateOrgCache();

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Org Import Error]", err instanceof Error ? err.message : err);
    // Only pass safe, expected error messages to client
    const message = err instanceof Error ? err.message : "";
    const safeMessages = [
      "Invalid export: manifest.json not found",
      "No file provided",
    ];
    const isSafe = safeMessages.some((m) => message.startsWith(m))
      || message.startsWith("Unsupported manifest version")
      || message.startsWith("Invalid entry path")
      || message.startsWith("Entry exceeds size limit")
      || message.startsWith("Total decompressed size")
      || message.startsWith("Invalid file path")
      || message.startsWith("ZIP file too large");
    return NextResponse.json(
      { error: isSafe ? message : "Import failed. Please check the file and try again." },
      { status: 500 }
    );
  }
}
