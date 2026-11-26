/** Hands a CSV string to the browser as a file. Callers build it with `toCsv` (`src/lib/csv.ts`, the formula guard). */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
