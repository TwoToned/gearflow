/**
 * The scanner's symbology catalogue — the single source of truth for which
 * barcode formats the in-app camera scanner will decode (R-3.1). The scanner
 * hook, the settings UI copy and FEATUREDOCS/19 all read this list; nothing
 * hand-maintains a second copy.
 *
 * Plain module (no "use server", no React) so the Zod schemas, the decode
 * worker-less loop and the jsdom tests can all share it.
 */

import type { ReadInputBarcodeFormat, ReadOutputBarcodeFormat } from "zxing-wasm/reader";

/**
 * Formats the scanner searches for, in ZXing-C++ canonical spelling.
 *
 * Deliberately a curated list rather than `"All"`. Two reasons:
 *
 * 1. **Cost.** ZXing runs a locator per enabled symbology family per frame.
 *    Enabling every DataBar/Telepen/DXFilmEdge variant we will never print
 *    buys nothing and costs frame rate on the phones that need it most.
 * 2. **Misreads.** The more linear symbologies are live, the higher the chance
 *    a partial read of one is accepted as a valid short code of another — a
 *    silent wrong-asset scan is worse than a no-read.
 *
 * `MicroQRCode` and `RMQRCode` are the reason this feature cannot use the
 * platform `BarcodeDetector` API on EITHER platform: neither is in the Shape
 * Detection API spec, so neither Chrome/Android's ML Kit backend nor any future
 * WebKit implementation can produce them. See `docs/designs/barcode-scanner-2d.md`.
 */
export const SCANNER_FORMATS = [
  // Ours — what RVLT Flow prints on asset / kit / test-tag labels.
  "QRCode",
  "MicroQRCode",
  "RMQRCode",
  // Other 2D, common on manufacturer plates and small electronics.
  "DataMatrix",
  "Aztec",
  "PDF417",
  // Linear industrial — serial-number labels on flight cases and gear.
  "Code128",
  "Code39",
  "Code93",
  "ITF",
  "Codabar",
  // Linear retail — consumables and sale stock.
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
] as const satisfies readonly ReadInputBarcodeFormat[];

/**
 * Human labels for the formats a scan can come back as. Keyed by the format
 * ZXing REPORTS (`ReadOutputBarcodeFormat`), which is not always one we asked
 * for: requesting `"EAN13"` can report `"ISBN"`, and requesting `"Code39"` can
 * report `"Code39Ext"`. `formatLabel` falls back to the raw name, so an
 * unmapped variant degrades to "Code39Ext" rather than to "undefined".
 */
const FORMAT_LABELS: Partial<Record<ReadOutputBarcodeFormat, string>> = {
  QRCode: "QR Code",
  QRCodeModel1: "QR Code",
  QRCodeModel2: "QR Code",
  MicroQRCode: "Micro QR",
  RMQRCode: "rMQR",
  DataMatrix: "Data Matrix",
  Aztec: "Aztec",
  AztecCode: "Aztec",
  PDF417: "PDF417",
  CompactPDF417: "PDF417",
  MicroPDF417: "MicroPDF417",
  Code128: "Code 128",
  Code39: "Code 39",
  Code39Std: "Code 39",
  Code39Ext: "Code 39",
  Code93: "Code 93",
  ITF: "ITF",
  ITF14: "ITF-14",
  Codabar: "Codabar",
  EAN13: "EAN-13",
  EAN8: "EAN-8",
  UPCA: "UPC-A",
  UPCE: "UPC-E",
  ISBN: "ISBN",
};

/** Display name for a decoded format, e.g. `"MicroQRCode"` → `"Micro QR"`. */
export function formatLabel(format: string): string {
  return FORMAT_LABELS[format as ReadOutputBarcodeFormat] ?? format;
}

/**
 * The tag grammar `convex/scanLookup.ts` / `convex/returnsLookup.ts` accept.
 * Kept byte-identical to their `SAFE_TAG` on purpose: a decode that could never
 * resolve server-side should be rejected at the camera with "not one of ours"
 * rather than burning a round trip and showing the operator a bare "not found".
 *
 * This is a DUPLICATE of a Convex-side constant only because `convex/` cannot
 * import from `src/` — the pairing is asserted in `formats.test.ts`.
 */
const SAFE_TAG = /^[A-Za-z0-9\-_.:/ ]+$/;
const MAX_TAG_LENGTH = 128;

/**
 * Normalise a raw decode into a tag, or `null` if it cannot be one.
 *
 * Trims surrounding whitespace (thermal printers and phone keyboards both
 * introduce it) and strips a `\r`/`\n` terminator, which many symbologies carry
 * and which would otherwise fail `SAFE_TAG` for a value that is perfectly good.
 */
export function normaliseScannedValue(raw: string): string | null {
  const value = raw.replace(/[\r\n]+$/, "").trim();
  if (!value || value.length > MAX_TAG_LENGTH) return null;
  if (!SAFE_TAG.test(value)) return null;
  return value;
}
