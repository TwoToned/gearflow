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
): Promise<{ regular: PDFFont; bold: PDFFont; oblique: PDFFont; courier: PDFFont }> {
  const cacheKey = "gearflow_helvetica_fonts";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) as { regular: PDFFont; bold: PDFFont; oblique: PDFFont; courier: PDFFont };
  }

  const regular = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  const oblique = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaOblique);
  const courier = await pdfDoc.embedFont(pdfLib.StandardFonts.Courier);

  const fonts = { regular, bold, oblique, courier };
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

// ─── Rich Text (simple markdown) ──────────────────────────────────────────

type RichSpan = { text: string; style: "regular" | "bold" | "italic" };
type RichLine = { spans: RichSpan[]; bullet: boolean };

/**
 * Parse simple markdown into lines of styled spans.
 * Supports: **bold**, *italic*, newlines, and `- ` bullet prefix.
 */
export function parseRichText(raw: string): RichLine[] {
  return raw.split("\n").map((line) => {
    const trimmed = line.trimStart();
    const bullet = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    const content = bullet ? trimmed.slice(2) : trimmed;

    const spans: RichSpan[] = [];
    // Match **bold** or *italic* segments
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      // Text before this match
      if (match.index > lastIndex) {
        spans.push({ text: content.slice(lastIndex, match.index), style: "regular" });
      }
      if (match[2]) {
        // **bold**
        spans.push({ text: match[2], style: "bold" });
      } else if (match[3]) {
        // *italic*
        spans.push({ text: match[3], style: "italic" });
      }
      lastIndex = match.index + match[0].length;
    }
    // Trailing text
    if (lastIndex < content.length) {
      spans.push({ text: content.slice(lastIndex), style: "regular" });
    }
    // Empty line — at least one empty span
    if (spans.length === 0) {
      spans.push({ text: "", style: "regular" });
    }

    return { spans, bullet };
  });
}

/**
 * Measure the height of rich text (lines x lineHeight).
 */
export function measureRichTextHeight(
  text: string,
  lineHeight: number,
): number {
  const lines = parseRichText(text);
  return lines.length * lineHeight;
}

/**
 * Draw parsed rich text onto a PDF page.
 * Returns total height consumed.
 */
export function drawRichText(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    fontSize: number;
    lineHeight: number;
    color: ReturnType<typeof import("@pdfme/pdf-lib").rgb>;
    fonts: { regular: PDFFont; bold: PDFFont; oblique: PDFFont };
  },
): number {
  const lines = parseRichText(text);
  let yPos = opts.y;

  for (const line of lines) {
    let xPos = opts.x;
    const bulletPrefix = line.bullet ? "\u2022 " : "";

    if (bulletPrefix) {
      page.drawText(bulletPrefix, {
        x: xPos,
        y: yPos,
        size: opts.fontSize,
        font: opts.fonts.regular,
        color: opts.color,
      });
      xPos += opts.fonts.regular.widthOfTextAtSize(bulletPrefix, opts.fontSize);
    }

    for (const span of line.spans) {
      if (!span.text) continue;
      const font =
        span.style === "bold" ? opts.fonts.bold :
        span.style === "italic" ? opts.fonts.oblique :
        opts.fonts.regular;

      page.drawText(span.text, {
        x: xPos,
        y: yPos,
        size: opts.fontSize,
        font,
        color: opts.color,
      });
      xPos += font.widthOfTextAtSize(span.text, opts.fontSize);
    }

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
