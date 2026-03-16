/**
 * Shared helper utilities for custom pdfme plugins.
 * Handles coordinate conversion, color parsing, and font loading.
 */
import type { PDFPage, PDFFont, PDFDocument } from "@pdfme/pdf-lib";
import type { Schema } from "@pdfme/common";
import { mm2pt } from "@pdfme/common";

// Re-export mm2pt for convenience
export { mm2pt };

/**
 * Convert schema mm position to PDF pt coordinates.
 * PDF Y-axis is from bottom-left; pdfme schemas use top-left origin.
 */
export function getLayoutProps(schema: Schema, pageHeight: number) {
  const width = mm2pt(schema.width);
  const height = mm2pt(schema.height);
  const x = mm2pt(schema.position.x);
  const y = pageHeight - mm2pt(schema.position.y) - height;
  return { x, y, width, height };
}

/**
 * Parse hex color to pdf-lib rgb() color.
 */
export function hexToRgb(hex: string, pdfLib: typeof import("@pdfme/pdf-lib")) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return pdfLib.rgb(r, g, b);
}

/**
 * Lighten a hex color by blending toward white.
 * amount = 0 means original, amount = 1 means white.
 */
export function lightenHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lr = Math.round((r + (1 - r) * amount) * 255);
  const lg = Math.round((g + (1 - g) * amount) * 255);
  const lb = Math.round((b + (1 - b) * amount) * 255);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/**
 * Embed Helvetica and Helvetica-Bold fonts from pdf-lib's standard fonts.
 * Uses caching to avoid re-embedding on every call.
 */
export async function getHelveticaFonts(
  pdfDoc: PDFDocument,
  pdfLib: typeof import("@pdfme/pdf-lib"),
  cache: Map<string | number, unknown>
): Promise<{ regular: PDFFont; bold: PDFFont; courier: PDFFont }> {
  const cacheKey = "gearflow_helvetica_fonts";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) as { regular: PDFFont; bold: PDFFont; courier: PDFFont };
  }

  const regular = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  const courier = await pdfDoc.embedFont(pdfLib.StandardFonts.Courier);

  const fonts = { regular, bold, courier };
  cache.set(cacheKey, fonts);
  return fonts;
}

/** Format currency (matching existing formatCurrency) */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "$0.00";
  return `$${Number(amount).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format date (matching existing formatDate) */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Truncate text to fit within a given width, adding ellipsis */
export function truncateText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

/**
 * Draw multi-line text that wraps within a given width.
 * Returns the total height consumed.
 */
export function drawWrappedText(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    maxWidth: number;
    font: PDFFont;
    fontSize: number;
    lineHeight: number;
    color: ReturnType<typeof import("@pdfme/pdf-lib").rgb>;
  }
): number {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (opts.font.widthOfTextAtSize(testLine, opts.fontSize) <= opts.maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  let yPos = opts.y;
  for (const line of lines) {
    page.drawText(line, {
      x: opts.x,
      y: yPos,
      size: opts.fontSize,
      font: opts.font,
      color: opts.color,
    });
    yPos -= opts.lineHeight;
  }

  return lines.length * opts.lineHeight;
}

/** Create a stub UI render function for server-only plugins */
export function stubUiRender() {
  return () => {
    // UI rendering is Phase 3 (template designer)
  };
}

/** Create a stub prop panel for server-only plugins */
export function stubPropPanel<T extends Schema>(defaultSchema: T) {
  return {
    schema: {} as Record<string, never>,
    defaultSchema,
  };
}
