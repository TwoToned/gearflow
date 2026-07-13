import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-server";
import { getServeInfo } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;
  const { path } = await params;
  const storageKey = path.join("/");

  if (storageKey.includes("\0")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Record-based auth (replaces the old S3 org-prefixed-key path check): look up the
  // file's org. "avatars" = global (any authed user); otherwise the caller's org must
  // match. A missing record → 404.
  const info = await getServeInfo(storageKey);
  if (!info) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (info.organizationId !== "avatars" && info.organizationId !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const upstream = await fetch(info.url);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const contentType = info.contentType || "application/octet-stream";
    const isImage = contentType.startsWith("image/");

    const headers: Record<string, string> = { "Content-Type": contentType };
    if (isImage) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else {
      let cleanName = (info.fileName || "download").replace(/[\r\n"\\/:]/g, "_").replace(/\.\./g, "_");
      cleanName = cleanName.replace(/^\.+/, "");
      if (!cleanName) cleanName = "download";
      const encodedName = encodeURIComponent(cleanName);
      headers["Content-Disposition"] = `inline; filename="${cleanName}"; filename*=UTF-8''${encodedName}`;
      headers["Cache-Control"] = "private, max-age=3600";
    }
    if (info.size) headers["Content-Length"] = String(info.size);

    return new NextResponse(upstream.body, { headers });
  } catch (error) {
    console.error("File serve error:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
