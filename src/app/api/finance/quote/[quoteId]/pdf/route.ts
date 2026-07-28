import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { quoteArtifactFileName } from "@/lib/finance-artifacts";
import { artifactNotFound, streamStoredArtifact } from "@/lib/finance-artifact-response";

export const runtime = "nodejs";

/**
 * `GET /api/finance/quote/[quoteId]/pdf` — the stored, immutable quote document
 * (#987). Streams the bytes rendered at SEND time and nothing else: there is no
 * regeneration path here, which is the entire point. Two downloads a week apart
 * are byte-identical even as the project changes underneath them.
 *
 * A SUPERSEDED or recalled revision stays downloadable — the client may be
 * holding that copy, so deleting ours would make the record worse, not better.
 * The Finance tab badges the state next to the download.
 *
 * Auth: `invoice:read`, plus the org check inside
 * `financeArtifacts.quoteArtifactContext` (`quotes.by_cuid` is a GLOBAL index —
 * R-8.4.3; this and its invoice twin are the highest-risk new surfaces in the
 * program, so both carry explicit cross-org tests).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;

  let organizationId: string;
  try {
    ({ organizationId } = await requirePermission("invoice", "read"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convex = await getConvexClient();
  let quote;
  try {
    quote = await convex.query(api.financeArtifacts.quoteArtifactContext, {
      quoteId,
      orgId: organizationId,
      now: Date.now(),
    });
  } catch {
    // Missing and another org's are indistinguishable by design.
    return artifactNotFound("Quote not found.");
  }

  if (!quote.pdfFileId) {
    return artifactNotFound("This revision has no stored document yet.");
  }

  return streamStoredArtifact({
    storageId: quote.pdfFileId,
    fileName: quoteArtifactFileName(quote.projectNumber, quote.version),
    organizationId,
  });
}
