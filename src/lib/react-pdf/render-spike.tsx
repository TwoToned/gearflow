/**
 * #1151 spike — manual render script. NOT part of the app or CI; run it by
 * hand to eyeball the output:
 *
 *   pnpm exec tsx src/lib/react-pdf/render-spike.tsx [outDir]
 *
 * Writes a handful of PDFs (default: a temp dir, printed on exit) covering
 * everything #1151 asks the spike to prove:
 *   - quote-long-icon.pdf       — the realistic long fixture (multi-page,
 *                                 icon header mode, no watermark)
 *   - quote-long-draft.pdf      — same fixture with the draft-preview
 *                                 watermark repeating on every page
 *   - quote-header-logo.pdf     — header logo mode, single page
 *   - quote-header-none.pdf     — header "none" mode, single page
 *   - quote-tc-freshpage.pdf    — a fixture sized so terms & conditions
 *                                 already lands first on a fresh page, to
 *                                 empirically check react-pdf's `break`
 *                                 doesn't insert a spurious blank page
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { QuoteDocument } from "./quote-document";
import { makeSpikeData, makeLongLineItemList } from "./fixture";

// Tiny 1x1 PNG — real image bytes are irrelevant to this spike (it's testing
// layout, not asset quality), just that <Image> embedding + sizing works.
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function renderAndReport(label: string, doc: Parameters<typeof renderToBuffer>[0], outPath: string) {
  const buffer = await renderToBuffer(doc);
  writeFileSync(outPath, buffer);
  const pdf = await PdfLibDocument.load(buffer);
  // eslint-disable-next-line no-console -- manual CLI dev script (like scripts/*.mts), not app code; POLICY.md R-8.9.5's structured logger requirement is for the running app, not a one-shot local render tool.
  console.log(`${label}: ${pdf.getPageCount()} page(s) -> ${outPath}`);
}

async function main() {
  const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), "react-pdf-spike-"));

  const longItems = makeLongLineItemList(60);
  const longData = makeSpikeData({
    line_items: longItems,
    total_items: longItems.length,
  });

  await renderAndReport("quote-long-icon", <QuoteDocument data={longData} />, join(outDir, "quote-long-icon.pdf"));

  await renderAndReport(
    "quote-long-draft",
    <QuoteDocument data={longData} draftPreview />,
    join(outDir, "quote-long-draft.pdf"),
  );

  const shortItems = makeLongLineItemList(1);
  await renderAndReport(
    "quote-header-logo",
    <QuoteDocument
      data={makeSpikeData({
        line_items: shortItems,
        total_items: shortItems.length,
        org_logo: PLACEHOLDER_PNG,
        org_branding: { documentLogoMode: "logo", showOrgNameOnDocuments: true, documentColor: "#0d4f4f" },
      })}
    />,
    join(outDir, "quote-header-logo.pdf"),
  );

  await renderAndReport(
    "quote-header-none",
    <QuoteDocument
      data={makeSpikeData({
        line_items: shortItems,
        total_items: shortItems.length,
        org_branding: { documentLogoMode: "none", showOrgNameOnDocuments: true, documentColor: "#0d4f4f" },
      })}
    />,
    join(outDir, "quote-header-none.pdf"),
  );

  // A fixture whose table + totals + notes are sized (empirically, by trial
  // item count) to just fill one page, so T&Cs would already land first on
  // page 2 without any forced break — checks whether react-pdf's `break`
  // prop inserts an unwanted extra blank page in that case (see
  // quote-document.tsx's comment + the findings doc).
  const freshPageItems = makeLongLineItemList(24);
  await renderAndReport(
    "quote-tc-freshpage",
    <QuoteDocument data={makeSpikeData({ line_items: freshPageItems, total_items: freshPageItems.length })} />,
    join(outDir, "quote-tc-freshpage.pdf"),
  );

  // eslint-disable-next-line no-console -- manual CLI dev script, see the reason above.
  console.log(`\nAll spike PDFs written to: ${outDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- manual CLI dev script, see the reason above.
  console.error(err);
  process.exit(1);
});
