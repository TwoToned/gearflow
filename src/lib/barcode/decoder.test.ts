import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeBarcode } from "zxing-wasm/writer";
import { configureDecoderModule, decodeImageData } from "./decoder";
import { SCANNER_FORMATS, formatLabel, normaliseScannedValue } from "./formats";

// In the browser the decoder fetches `/wasm/zxing_reader.wasm` from our own
// origin; under Node there is no origin to fetch from, so hand emscripten the
// bytes instead. Reading the COMMITTED copy (not the one in node_modules) means
// these tests exercise the exact binary that ships — which, together with the
// `wasm:sync:check` CI gate, is what makes "the committed wasm actually
// decodes" a tested property rather than an assumption.
beforeAll(() => {
  configureDecoderModule({
    wasmBinary: readFileSync(resolve(process.cwd(), "public/wasm/zxing_reader.wasm")),
  });
});

/**
 * Round-trip decode tests: encode a real symbol with ZXing's writer, render it
 * to `ImageData` exactly the way the camera pump hands frames to the decoder,
 * and assert our `decodeImageData` reads it back.
 *
 * This is the test class the first scanner never had. Unit-testing the UI
 * around a decoder proves nothing about whether the decoder decodes; the only
 * reason "it just didn't work on iOS" could ship was that nothing anywhere
 * asserted a symbol in, a value out. Micro QR and rMQR especially — the two
 * formats this feature exists for — are the ones most likely to be silently
 * absent from an engine, because no platform `BarcodeDetector` implements them.
 *
 * What this does NOT cover: `getUserMedia`, the frame pump, and the real-optics
 * questions (focus distance, motion blur). Those need a device — see
 * `docs/designs/barcode-scanner-2d.md` §"Device verification".
 */

/** A generous quiet zone in modules. Below ~4, 2D locators start failing legitimately. */
const QUIET_MODULES = 6;

/**
 * Render a written symbol to `ImageData`: nearest-neighbour upscale to `scale`
 * pixels per module, plus a white quiet zone. `writeBarcode`'s `symbol` is the
 * bare matrix — one byte per module, 0 = black — with no quiet zone of its own.
 */
function toImageData(
  symbol: { data: Uint8ClampedArray; width: number; height: number },
  scale: number,
): ImageData {
  const pad = QUIET_MODULES * scale;
  const width = symbol.width * scale + pad * 2;
  const height = symbol.height * scale + pad * 2;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

  for (let y = 0; y < height; y++) {
    const sy = Math.floor((y - pad) / scale);
    if (sy < 0 || sy >= symbol.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x - pad) / scale);
      if (sx < 0 || sx >= symbol.width) continue;
      const value = symbol.data[sy * symbol.width + sx] ?? 255;
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
    }
  }
  // Node has no ImageData constructor; the decoder only reads these three fields.
  return { data: rgba, width, height, colorSpace: "srgb" } as ImageData;
}

async function roundTrip(format: string, text: string, scale = 8) {
  const written = await writeBarcode(text, { format: format as Parameters<typeof writeBarcode>[1] extends infer O ? O extends { format: infer F } ? F : never : never });
  expect(written.error, `writer failed for ${format}`).toBeFalsy();
  expect(written.symbol, `no symbol matrix for ${format}`).toBeTruthy();
  return decodeImageData(toImageData(written.symbol!, scale));
}

describe("decodeImageData — the QR family this feature exists for", () => {
  it.each([
    ["QRCode", "A-1042"],
    ["MicroQRCode", "A-1042"],
    ["RMQRCode", "A-1042"],
  ])("round-trips %s", async (format, text) => {
    const results = await roundTrip(format, text);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text).toBe(text);
    expect(results[0]!.isValid).toBe(true);
  }, 30_000);

  it("reports Micro QR distinctly from a full QR", async () => {
    // If the engine silently fell back to treating a Micro QR as a QR, the
    // value might still come out — but the format wouldn't, and the operator
    // would be told the wrong thing about what they scanned.
    const micro = await roundTrip("MicroQRCode", "A-1042");
    expect(micro[0]!.format).toBe("MicroQRCode");
    expect(formatLabel(micro[0]!.format)).toBe("Micro QR");
  }, 30_000);

  it("reports rMQR distinctly", async () => {
    const rmqr = await roundTrip("RMQRCode", "A-1042");
    expect(rmqr[0]!.format).toBe("RMQRCode");
    expect(formatLabel(rmqr[0]!.format)).toBe("rMQR");
  }, 30_000);
});

describe("decodeImageData — the other 2D symbologies", () => {
  it.each([["DataMatrix"], ["Aztec"], ["PDF417"]])("round-trips %s", async (format) => {
    const results = await roundTrip(format, "A-1042");
    expect(results[0]?.text).toBe("A-1042");
  }, 30_000);
});

describe("decodeImageData — linear symbologies", () => {
  it.each([
    ["Code128", "A-1042"],
    ["Code39", "A-1042"],
    ["Code93", "A-1042"],
  ])("round-trips %s", async (format, text) => {
    const results = await roundTrip(format, text, 4);
    expect(results[0]?.text).toBe(text);
  }, 30_000);

  it("round-trips a retail EAN-13", async () => {
    const results = await roundTrip("EAN13", "9312345678907", 4);
    expect(results[0]?.text).toBe("9312345678907");
  }, 30_000);
});

describe("decodeImageData — behaviour under the scanner's options", () => {
  it("reads an INVERTED symbol (white-on-black flight-case labels)", async () => {
    const written = await writeBarcode("A-1042", { format: "QRCode" });
    const image = toImageData(written.symbol!, 8);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 255 - image.data[i]!;
      image.data[i + 1] = 255 - image.data[i + 1]!;
      image.data[i + 2] = 255 - image.data[i + 2]!;
    }
    // tryInvert: true in decoder.ts is what makes this pass.
    const results = await decodeImageData(image);
    expect(results[0]?.text).toBe("A-1042");
  }, 30_000);

  it("returns nothing for a blank frame rather than throwing", async () => {
    // The pump calls this ~8x/second at whatever the camera is pointed at.
    // An empty frame is the common case, not an error.
    const blank = {
      data: new Uint8ClampedArray(200 * 200 * 4).fill(255),
      width: 200,
      height: 200,
      colorSpace: "srgb",
    } as ImageData;
    await expect(decodeImageData(blank)).resolves.toEqual([]);
  }, 30_000);

  it("decodes every format in SCANNER_FORMATS that the writer can produce", async () => {
    // A ratchet on the catalogue itself: adding a format to SCANNER_FORMATS
    // that the engine can't actually read would otherwise be invisible until a
    // warehouse pointed a phone at one.
    const writable = SCANNER_FORMATS.filter((f) => !["UPCE", "ITF", "Codabar", "EAN8", "UPCA", "EAN13"].includes(f));
    for (const format of writable) {
      const results = await roundTrip(format, "A-1042", 6);
      expect(results[0]?.text, `${format} did not decode`).toBe("A-1042");
    }
  }, 120_000);
});

describe("decode → tag normalisation, end to end", () => {
  it("turns a decoded QR into a tag the server will accept", async () => {
    const results = await roundTrip("QRCode", "A-1042");
    expect(normaliseScannedValue(results[0]!.text)).toBe("A-1042");
  }, 30_000);

  it("drops a decode carrying characters no tag can contain", async () => {
    // Pointing a camera at a warehouse means incidentally reading shipping
    // labels and marketing QRs. Anything outside the grammar is dropped at the
    // camera rather than sent to the server to come back "not found".
    const results = await roundTrip("QRCode", "https://example.com/promo?utm=1");
    expect(results[0]!.text).toBe("https://example.com/promo?utm=1");
    expect(normaliseScannedValue(results[0]!.text)).toBeNull();
  }, 30_000);

  it("passes a URL-SHAPED value through — the grammar cannot reject it", async () => {
    // Documenting a real limit rather than pretending otherwise: `:` `/` and `.`
    // are all legal tag characters, so a query-less URL satisfies the grammar and
    // reaches the server, which answers "no such tag". Tightening the grammar to
    // exclude it would have to be done on the server first (it is the authority),
    // and would risk rejecting tags orgs legitimately use.
    const results = await roundTrip("QRCode", "https://example.com/promo");
    expect(normaliseScannedValue(results[0]!.text)).toBe("https://example.com/promo");
  }, 30_000);
});
