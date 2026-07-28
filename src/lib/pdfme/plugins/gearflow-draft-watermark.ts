/**
 * gearflowDraftWatermark plugin (#987) — the "DRAFT PREVIEW — NOT SENT" banner.
 *
 * Rendered ONLY by the `preview=1` path (`/api/documents/[projectId]`), never by
 * a stored artifact: a preview shows live, un-frozen pricing and has no record
 * anywhere in Flow, so a client who receives one by accident must be able to
 * tell at a glance. It is a flow BLOCK (drawn at the top of every page,
 * reserving its own height in `document-composer.ts`) rather than a rotated
 * overlay, because the composer paginates by measured block height — an overlay
 * that reserved nothing would be the v0.8.1.1 tail-drop bug with extra steps.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, truncateText, stubUiRender, stubPropPanel } from "./helpers";
import type { DraftWatermarkConfig } from "../types";

interface DraftWatermarkSchema extends Schema {
  type: "gearflowDraftWatermark";
}

/** Deliberately NOT the org's document colour — this banner is a warning about
 *  the document, not part of its branding, and must read as foreign to it. */
const BANNER_BG = "#fdeceb";
const BANNER_BORDER = "#b42318";
const TITLE_COLOR = "#b42318";
const SUBTITLE_COLOR = "#7a271a";

const TITLE_SIZE = 14;
const SUBTITLE_SIZE = 7.5;
const PADDING_X = 8;

async function pdfRender(arg: PDFRenderProps<DraftWatermarkSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const config = JSON.parse(arg.value || "{}") as Partial<DraftWatermarkConfig>;
  const title = config.title || "DRAFT PREVIEW — NOT SENT";
  const subtitle = config.subtitle || "";

  const { x, y, width, height } = getLayoutProps(schema, page.getHeight());
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: hexToRgb(BANNER_BG, pdfLib),
    borderColor: hexToRgb(BANNER_BORDER, pdfLib),
    borderWidth: 1,
  });

  const innerWidth = width - PADDING_X * 2;
  // Helvetica has no em dash (pdfme is Helvetica-only, no Unicode — CLAUDE.md),
  // so normalise anything outside WinAnsi to a hyphen before measuring/drawing.
  const safeTitle = toHelvetica(title);
  const safeSubtitle = toHelvetica(subtitle);

  const titleText = truncateText(safeTitle, fonts.bold, TITLE_SIZE, innerWidth);
  const titleWidth = fonts.bold.widthOfTextAtSize(titleText, TITLE_SIZE);
  page.drawText(titleText, {
    x: x + (width - titleWidth) / 2,
    y: y + height - TITLE_SIZE - (subtitle ? 6 : (height - TITLE_SIZE) / 2),
    size: TITLE_SIZE,
    font: fonts.bold,
    color: hexToRgb(TITLE_COLOR, pdfLib),
  });

  if (safeSubtitle) {
    const subtitleText = truncateText(safeSubtitle, fonts.regular, SUBTITLE_SIZE, innerWidth);
    const subtitleWidth = fonts.regular.widthOfTextAtSize(subtitleText, SUBTITLE_SIZE);
    page.drawText(subtitleText, {
      x: x + (width - subtitleWidth) / 2,
      y: y + 6,
      size: SUBTITLE_SIZE,
      font: fonts.regular,
      color: hexToRgb(SUBTITLE_COLOR, pdfLib),
    });
  }
}

/** Replace the handful of typographic characters our copy uses with WinAnsi
 *  equivalents Helvetica can actually encode (an em dash throws in pdf-lib). */
function toHelvetica(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

const gearflowDraftWatermark: Plugin<DraftWatermarkSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowDraftWatermark",
    position: { x: 0, y: 0 },
    width: 170,
    height: 14,
  }),
};

export default gearflowDraftWatermark;
