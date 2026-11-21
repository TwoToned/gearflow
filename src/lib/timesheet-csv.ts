import { toCsv } from "@/lib/csv";

/**
 * The timesheet CSV (UX Phase 15): one shape for the server "Export all…" and
 * the list's bulk Export, every cell through `src/lib/csv.ts` (formula-injection
 * guard). The twelve original columns keep their order and the raw status enum
 * (payroll imports read them); `Query reason` and, for a caller the SERVER
 * cleared to see pay (manager+, D49), `Rate (pay)` and `Total` are appended.
 * This module never decides who sees pay. Plain module.
 */
export interface TimesheetCsvRow {
  name: string;
  email: string;
  projectNumber: string;
  projectName: string;
  role: string;
  description: string;
  /** `YYYY-MM-DD` */
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number | null;
  status: string;
  queryReason: string;
  /** Present only for a caller allowed to see pay. `null` = blank (not $0). */
  pay?: { rate: number | null; total: number | null; included: boolean };
}

const BASE_HEADER = ["Crew Member", "Email", "Project Number", "Project Name", "Role", "Description", "Date", "Start Time", "End Time", "Break (min)", "Total Hours", "Status", "Query reason"];
const PAY_HEADER = ["Rate (pay)", "Total"];

const num = (n: number | null | undefined): string => (n == null ? "" : String(n));

function payCells(pay: NonNullable<TimesheetCsvRow["pay"]>): string[] {
  return [num(pay.rate), pay.included ? "incl." : num(pay.total)];
}

/** `withPay` adds the two pay columns; rows without `pay` then print them blank. */
export function timesheetCsv(rows: readonly TimesheetCsvRow[], withPay: boolean): string {
  const header = withPay ? [...BASE_HEADER, ...PAY_HEADER] : BASE_HEADER;
  const body = rows.map((r) => {
    const base = [
      r.name, r.email, r.projectNumber, r.projectName, r.role, r.description, r.date, r.startTime, r.endTime,
      String(r.breakMinutes), num(r.totalHours), r.status, r.queryReason,
    ];
    if (!withPay) return base;
    return [...base, ...(r.pay ? payCells(r.pay) : ["", ""])];
  });
  return toCsv(header, body);
}
