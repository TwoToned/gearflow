import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { exportTimesheetCSV } from "@/server/crew-time";

/**
 * GET /api/crew/timesheet?dateFrom=...&dateTo=...&crewMemberId=...&projectId=...&status=...
 *
 * Download timesheet data as CSV. Requires authentication (session-based).
 * The filters are Zod-validated inside `exportTimesheetCSV`
 * (`timesheetExportFiltersSchema`): a bad filter is a 400, not a 401.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const filters = {
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      crewMemberId: params.get("crewMemberId") || undefined,
      projectId: params.get("projectId") || undefined,
      status: params.get("status") || undefined,
    };

    const csv = await exportTimesheetCSV(filters);
    const date = new Date().toISOString().split("T")[0];

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="timesheet-${date}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
