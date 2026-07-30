import { NextResponse, type NextRequest } from "next/server";
import { authenticateRoute } from "@/lib/api/route-auth";
import { toErrorEnvelope, statusForError } from "@/lib/api/errors";
import { withApiVersionHeader } from "@/lib/api/version";
import { resolveProjectDocument, AGENT_DOCUMENT_TYPES } from "@/lib/api/documents";
import { streamStoredArtifact } from "@/lib/finance-artifact-response";

export const runtime = "nodejs";

/**
 * `GET /api/v1/documents/{projectId}?type=<docType>` — an agent-facing
 * counterpart to the session-only `/api/documents/[projectId]` route, and to
 * `/api/finance/{quote,invoice}/[id]/pdf` for the two stored types.
 *
 * Bypasses `dispatch()`/the operation registry entirely (like `whoami`) — see
 * `src/lib/api/documents.ts` for why this can't be a Convex operation. Auth +
 * RBAC/scope are still fully enforced (`authenticateRoute` + the
 * `requirePermission` calls inside `resolveProjectDocument`), just via the
 * Node-side path rather than a Convex guard.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;

  const { projectId } = await params;
  const type = new URL(request.url).searchParams.get("type") ?? "";

  try {
    const outcome = await resolveProjectDocument(auth.agent.actor, projectId, type as (typeof AGENT_DOCUMENT_TYPES)[number]);

    if (outcome.kind === "stored") {
      return streamStoredArtifact({
        storageId: outcome.storageId,
        fileName: outcome.fileName,
        organizationId: outcome.organizationId,
      });
    }

    return new NextResponse(new Uint8Array(outcome.bytes), {
      headers: {
        "Content-Type": outcome.contentType,
        "Content-Disposition": `inline; filename="${outcome.fileName}"`,
        "X-Document-Status": outcome.status,
      },
    });
  } catch (err) {
    return withApiVersionHeader(NextResponse.json(toErrorEnvelope(err, { requestId }), { status: statusForError(err) }));
  }
}
