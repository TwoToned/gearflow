/**
 * The one CSV cell-escaping rule (R-3.1). A cell that starts with a character a
 * spreadsheet reads as a formula (`= + - @`, tab, CR, and the full-width look-alikes)
 * is prefixed with `'` so it opens as text; then the cell is quoted when it holds a
 * comma, quote, CR or LF. Plain module: server actions and client exports share it.
 */
const FORMULA_STARTS = new Set(["=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠"]);

export function csvCell(value: string): string {
  const safe = value !== "" && FORMULA_STARTS.has(value[0]) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A header row plus data rows, each cell through `csvCell`, joined with LF. */
export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
