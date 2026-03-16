/**
 * Font configuration for pdfme generation.
 * Phase 1 uses pdfme's built-in default font.
 * Custom plugins use pdf-lib's built-in Helvetica/Helvetica-Bold for exact backward compat.
 */
import { getDefaultFont } from "@pdfme/common";

export function getPdfmeFonts() {
  return getDefaultFont();
}
