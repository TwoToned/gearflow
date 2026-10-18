/**
 * The label QR is hand-drawn vector paths, so prove it by decoding it back with
 * the same engine the in-app scanner uses — a path that "renders" but doesn't
 * scan is exactly the failure a label can't afford.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configureDecoderModule, decodeImageData } from "@/lib/barcode/decoder";
import { qrPathData } from "./qr-code";

beforeAll(() => {
  configureDecoderModule({ wasmBinary: readFileSync(resolve(process.cwd(), "public/wasm/zxing_reader.wasm")) });
});

/** Paint the path's dark modules into an RGBA buffer the way the pump hands frames over. */
function toImageData(d: string, size: number, scale = 8, pad = 4 * 8): ImageData {
  const px = size * scale + pad * 2;
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const [, c, r] of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const i = ((Number(r) * scale + pad + y) * px + Number(c) * scale + pad + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return { data: rgba, width: px, height: px, colorSpace: "srgb" } as ImageData;
}

describe("qrPathData", () => {
  it.each(["ACC-0042", "TTP00077", "A-1042"])("decodes back to the asset tag %s", async (tag) => {
    const { d, size } = qrPathData(tag);
    const results = await decodeImageData(toImageData(d, size));
    expect(results[0]?.text).toBe(tag);
  }, 30_000);
});
