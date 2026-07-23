/**
 * The only call site for @pdfme/generator's `generate()` in the app (POLICY.md
 * R-8.10.1) — every PDF generation path routes through this, and
 * `no-restricted-imports` blocks importing `@pdfme/generator` anywhere else.
 *
 * Kept in its own module (not generate-pdf.ts): generate-pdf.ts dynamically
 * imports templates/call-sheet-services.ts, so if call-sheet-services.ts
 * imported this function back from generate-pdf.ts, the two would form a
 * circular dependency (caught by the depcruise-ratchet CI check).
 */
import { generate } from "@pdfme/generator";
import type { Template } from "@pdfme/common";
import { gearflowPlugins } from "./plugins";
import { getPdfmeFonts } from "./fonts";

export async function renderPdfTemplate(
  template: Template,
  inputs: Record<string, string>[],
): Promise<Uint8Array> {
  return generate({
    template,
    inputs,
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });
}
