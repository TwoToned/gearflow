/**
 * Phase 0 (gearflow#1297, tracking #1296) — the render helper used to produce
 * the delivery-docket before/after PDFs referenced in
 * `docs/designs/packing-containers-manifest.md` §2. `describe.skip` by
 * default (it writes files to disk, which no CI run should do); set
 * `RENDER_FIXTURES=1` to actually render, e.g.:
 *
 *   RENDER_FIXTURES=1 pnpm exec vitest run src/lib/react-pdf/render-fixtures.test.tsx
 *
 * Phase 3 reuses this to attach before/after PDFs to the docket-rework and
 * manifest PRs (build plan phase 3c: "Before/after PDFs from phase 0's
 * render helper attached to the PR").
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, it } from "vitest";
import { DeliveryDocketDocument } from "./delivery-docket-document";
import { PackingListDocument } from "./packing-list-document";
import { ReturnSheetDocument } from "./return-sheet-document";
import { makeSpikeData, makeLongLineItemList } from "./fixture";
import type { DocumentData, DocumentLineItem } from "@/lib/pdfme/types";

const OUT_DIR = process.env.RENDER_FIXTURES_DIR || path.join(process.cwd(), ".scratch", "pdf-fixtures");

/** Three ungrouped-with-container rows, as the design doc's rendered sample
 *  describes (§2: "three ungrouped-with-container rows added"). */
function withContainerRows(items: DocumentLineItem[]): DocumentLineItem[] {
  return [
    ...items,
    { ...items[0], id: "container-a", description: "XLR 5m", prepContainer: "Case 12", categoryName: null, groupName: null },
    { ...items[0], id: "container-b", description: "Par Can", prepContainer: "Case 12", categoryName: null, groupName: null },
    { ...items[0], id: "container-c", description: "DMX Controller", prepContainer: "Tub 3", categoryName: null, groupName: null },
  ];
}

async function renderTo(fileName: string, element: Parameters<typeof renderToBuffer>[0]): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const buffer = await renderToBuffer(element);
  await writeFile(path.join(OUT_DIR, fileName), buffer);
}

const maybeDescribe = process.env.RENDER_FIXTURES ? describe : describe.skip;

maybeDescribe("render fixtures (manual, RENDER_FIXTURES=1) — packing containers before/after", () => {
  it("renders the delivery docket, packing list and return sheet against the design doc's fixture", async () => {
    const items = withContainerRows(makeLongLineItemList(14));
    const data: DocumentData = makeSpikeData({ line_items: items, total_items: items.length });

    await renderTo("delivery-docket.pdf", <DeliveryDocketDocument data={data} />);
    await renderTo("packing-list.pdf", <PackingListDocument data={data} />);
    await renderTo("return-sheet.pdf", <ReturnSheetDocument data={data} />);
  });
});
