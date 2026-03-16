import { NextRequest, NextResponse } from "next/server";
import {
  validateDisplayToken,
  getWarehouseDisplayData,
} from "@/server/warehouse-display";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const record = await validateDisplayToken(token);
  if (!record) {
    return NextResponse.json(
      { error: "Invalid or revoked display token" },
      { status: 404 }
    );
  }

  const data = await getWarehouseDisplayData(
    record.organizationId,
    record.locationId
  );

  return NextResponse.json({
    ...data,
    layout: record.layout,
    tokenName: record.name,
  }, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
