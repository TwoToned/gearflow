import { parseRichText } from "@/lib/pdfme/plugins/helpers";

/**
 * The job's crew notes as plain printable lines (UX Phase 10, spec §8c: crew notes
 * print at the top of the call sheet and the runsheet). ONE place turns the stored
 * text into lines, so the pdfme call sheet and the HTML runsheet print the same
 * thing: the `**bold**` / `*italic*` markers go, a `- ` bullet becomes `bullet`
 * (`• ` by default; the pdfme call sheet is Helvetica-only and passes `- `), blank
 * lines at the ends go. Empty or whitespace-only notes print nothing (`[]`).
 */
export function crewNotesLines(raw: string | null | undefined, bullet = "• "): string[] {
  if (!raw || !raw.trim()) return [];
  const lines = parseRichText(raw).map((l) => (l.bullet ? bullet : "") +l.spans.map((s) => s.text).join("").trimEnd());
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}
