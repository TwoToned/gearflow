/**
 * ZXing-C++ (WebAssembly) decode entry point — the ONE place the app reads a
 * barcode out of pixels.
 *
 * ## Why WASM on both platforms, not the platform API
 *
 * The obvious design is "native `BarcodeDetector` where it exists, WASM as an
 * iOS fallback". We deliberately do not do that:
 *
 * - WebKit has never shipped `BarcodeDetector`, so every browser on iOS (all of
 *   which are WKWebView) needs the WASM path regardless. That is not a fallback,
 *   it is half the fleet.
 * - `MicroQRCode` / `RMQRCode` are not in the Shape Detection API spec at all,
 *   so Chrome on Android cannot decode them either. The platform API cannot
 *   satisfy the requirement on EITHER platform.
 *
 * Shipping both engines would therefore mean two decoders with different format
 * coverage, different rotation/inversion behaviour and different failure modes,
 * reachable from the same button — i.e. exactly the "works on my phone" class of
 * bug that sank the first scanner. One engine, one behaviour, everywhere.
 *
 * ## Self-hosted binary
 *
 * `zxing-wasm` fetches its `.wasm` from jsDelivr by default. We point it at our
 * own origin (`/wasm/zxing_reader.wasm`, kept in sync by
 * `scripts/sync-zxing-wasm.mjs`) so the scanner does not depend on a third-party
 * CDN being reachable from a warehouse — see that script's header.
 */

import {
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader";
import { SCANNER_FORMATS } from "./formats";

/** Where `sync-zxing-wasm.mjs` puts the binary, served from `public/`. */
const ZXING_WASM_PATH = "/wasm/zxing_reader.wasm";

const DEFAULT_OVERRIDES: ZXingModuleOverrides = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith(".wasm") ? ZXING_WASM_PATH : prefix + path,
};

let overrides: ZXingModuleOverrides = DEFAULT_OVERRIDES;
let modulePromise: Promise<unknown> | null = null;

/**
 * Change how the decoder obtains its `.wasm`.
 *
 * `zxing-wasm`'s ES build targets the web and instantiates by `fetch`, so the
 * default `locateFile` above only works where there is an origin to fetch from.
 * Two callers need something else:
 *
 * - The round-trip tests in `decoder.test.ts` run under Node, where an absolute
 *   URL path resolves to nothing; they pass `wasmBinary` (the bytes) directly.
 * - A deployment serving `public/` behind a path prefix or an asset host would
 *   pass its own `locateFile`.
 *
 * Must be called before the first decode — it clears the memoised module so a
 * late call cannot leave two instantiations racing.
 */
export function configureDecoderModule(next: ZXingModuleOverrides): void {
  overrides = next;
  modulePromise = null;
}

/**
 * Fetch + instantiate the decoder. Idempotent and cached: `prepareZXingModule`
 * memoises on the overrides object, but we also hold the promise so concurrent
 * callers (the warm-up on dialog open and the first frame) share one download.
 *
 * Separated from `decodeImageData` so the UI can show "Starting camera…" and
 * "Loading decoder…" as distinct states — a ~930 KiB download on warehouse wifi
 * is long enough that a silent wait reads as a hang.
 */
export function loadDecoder(): Promise<unknown> {
  modulePromise ??= prepareZXingModule({ overrides, fireImmediately: true });
  return modulePromise;
}

/**
 * Decode every barcode in one frame.
 *
 * The option set is tuned for a hand-held phone pointed at a label, which is the
 * opposite of the library's "scan this clean PNG" default case:
 *
 * - `tryHarder` — the accuracy/speed trade-off is worth it here. A dropped frame
 *   costs nothing (the next one is 125 ms away); a missed code costs a re-aim.
 * - `tryRotate` — operators scan sideways constantly (gear in a rack, a label on
 *   a case lid). Linear codes especially.
 * - `tryInvert` — white-on-black labels are common on flight cases.
 * - `tryDownscale` — lets ZXing find a large, close-up code without us having to
 *   guess the right capture resolution.
 * - `maxNumberOfSymbols: 1` — we act on a single tag. Capping it lets the
 *   locator stop at the first hit instead of sweeping the rest of the frame.
 * - `returnErrors: false` — a checksum-failed read must never reach the caller
 *   as if it were a tag.
 */
export async function decodeImageData(image: ImageData): Promise<ReadResult[]> {
  await loadDecoder();
  const options = {
    formats: [...SCANNER_FORMATS],
    tryHarder: true,
    tryRotate: true,
    // Covers inverted 2D symbols only — see `invertedCopy` for linear codes.
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
    returnErrors: false,
  } as const;
  const direct = await readBarcodes(image, options);
  if (direct.length > 0) return direct;
  // A frame with nothing in it costs a second pass; a white-on-black linear
  // label (flight-case tags) would otherwise never read at all.
  return readBarcodes(invertedCopy(image), options);
}

/**
 * Luminance-inverted copy of a frame.
 *
 * ZXing's `tryInvert` does not reach linear symbologies in the shipped build:
 * a white-on-black Code 39 / Code 128 label (e.g. the Two Toned tags) decodes
 * fine when inverted by hand and never with `tryInvert` alone — verified by the
 * round-trip tests in `decoder.test.ts`. Hence the explicit second pass.
 */
function invertedCopy(image: ImageData): ImageData {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  // Node (tests) has no ImageData constructor; the decoder reads only these fields.
  return { data, width: image.width, height: image.height, colorSpace: image.colorSpace } as ImageData;
}
