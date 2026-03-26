import { NextRequest, NextResponse } from "next/server";
import { validateAuditorToken, getAuditorPortalData } from "@/server/test-tag-auditor";

/**
 * GET /api/auditor/[token]
 *
 * Public endpoint — returns test-tag register data for a valid auditor token.
 * No authentication required; access controlled by token validity + expiry.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const record = await validateAuditorToken(token);
  if (!record) {
    return NextResponse.json(
      { error: "Invalid, expired, or revoked auditor link" },
      { status: 404 }
    );
  }

  const data = await getAuditorPortalData(record.organizationId, record.parsedScope);

  return NextResponse.json(
    { ...data, tokenName: record.name },
    {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
