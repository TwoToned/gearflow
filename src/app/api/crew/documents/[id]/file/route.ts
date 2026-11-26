import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { getCurrentRole } from "@/lib/org-context";
import { hasPermission } from "@/lib/permissions";
import { getConvexClient } from "@/lib/convex-client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { api } from "../../../../../../../convex/_generated/api";
import { crewDocumentsVisible } from "../../../../../../../convex/lib/crewDocumentCore";

export const runtime = "nodejs";

/**
 * The ONLY way to download a crew document (UX Phase 13, D72; owner ruling B2). The generic
 * `/api/files` serve and `files.getServeInfo` refuse the `crew-documents` folder, so org membership
 * is never enough. The caller must be a USER session (this route reads the cookie session; an API
 * key has no way in) who is the member themself or holds `crew:update`: `crewDocumentsVisible`, the
 * same rule every Convex read applies. A caller who fails it gets the same 404 as a missing
 * document, so the route does not confirm that one exists. The bytes are sent `private, no-store`.
 */
const idSchema = z.string().min(1).max(64);

/** THE rule (`crewDocumentsVisible`) for the real caller: a user session that is the member or holds `crew:update`. */
async function mayDownload(memberUserId: string | null, callerUserId: string): Promise<boolean> {
  const role = await getCurrentRole();
  return crewDocumentsVisible({ userSession: true, managesCrew: role != null && hasPermission(role, "crew", "update"), isSelf: memberUserId != null && memberUserId === callerUserId });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const info = await (await getConvexClient()).query(api.crewDocuments.getForDownload, { orgId: ctx.organizationId, id: id.data });
    if (!info || !(await mayDownload(info.memberUserId, ctx.session.user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const upstream = await fetchWithTimeout(info.url);
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let cleanName = (info.fileName || "document").replace(/[\r\n"\\/:]/g, "_").replace(/\.\./g, "_").replace(/^\.+/, "");
    if (!cleanName) cleanName = "document";
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": info.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${cleanName}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`,
        "Content-Length": String(info.fileSize),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Crew document serve error", { error });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
