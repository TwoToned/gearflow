import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SCANNER_FORMATS, formatLabel, normaliseScannedValue } from "./formats";

describe("SCANNER_FORMATS", () => {
  it("includes the three QR variants the feature exists for", () => {
    // The whole reason this scanner can't use the platform BarcodeDetector API:
    // Micro QR and rMQR are not in the Shape Detection API spec, so neither
    // Chrome/Android's ML Kit backend nor any future WebKit one can produce them.
    expect(SCANNER_FORMATS).toContain("QRCode");
    expect(SCANNER_FORMATS).toContain("MicroQRCode");
    expect(SCANNER_FORMATS).toContain("RMQRCode");
  });

  it("includes the other 2D symbologies", () => {
    expect(SCANNER_FORMATS).toContain("DataMatrix");
    expect(SCANNER_FORMATS).toContain("Aztec");
    expect(SCANNER_FORMATS).toContain("PDF417");
  });

  it("has no duplicates", () => {
    expect(new Set(SCANNER_FORMATS).size).toBe(SCANNER_FORMATS.length);
  });

  it("is a curated list, not a meta-format", () => {
    // "All" would re-enable every DataBar/Telepen/DXFilmEdge variant we never
    // print, costing frame rate and widening the misread surface. See formats.ts.
    expect(SCANNER_FORMATS).not.toContain("All" as never);
    expect(SCANNER_FORMATS).not.toContain("AllReadable" as never);
  });
});

describe("formatLabel", () => {
  it("maps the QR family to operator-facing names", () => {
    expect(formatLabel("MicroQRCode")).toBe("Micro QR");
    expect(formatLabel("RMQRCode")).toBe("rMQR");
    expect(formatLabel("QRCode")).toBe("QR Code");
  });

  it("falls back to the raw name for a variant we didn't map", () => {
    // ZXing reports variants we never requested (asking for Code39 can report
    // Code39Ext). Degrading to the raw name beats rendering "undefined".
    expect(formatLabel("SomeFutureFormat")).toBe("SomeFutureFormat");
  });
});

describe("normaliseScannedValue", () => {
  it("accepts a plain asset tag", () => {
    expect(normaliseScannedValue("A-1042")).toBe("A-1042");
  });

  it("strips the trailing CR/LF many symbologies carry", () => {
    // A terminator would fail SAFE_TAG for a value that is perfectly good —
    // this is the difference between a working scan and a bare "not found".
    expect(normaliseScannedValue("A-1042\r\n")).toBe("A-1042");
    expect(normaliseScannedValue("A-1042\n")).toBe("A-1042");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseScannedValue("  A-1042  ")).toBe("A-1042");
  });

  it("accepts every character class the server's SAFE_TAG allows", () => {
    expect(normaliseScannedValue("AB-12_3.4:5/6 7")).toBe("AB-12_3.4:5/6 7");
  });

  it("rejects values the server would reject anyway", () => {
    expect(normaliseScannedValue("")).toBeNull();
    expect(normaliseScannedValue("   ")).toBeNull();
    expect(normaliseScannedValue("https://example.com?x=1")).toBeNull();
    expect(normaliseScannedValue("a".repeat(129))).toBeNull();
  });

  it("accepts exactly the server's maximum length", () => {
    expect(normaliseScannedValue("a".repeat(128))).toBe("a".repeat(128));
  });
});

describe("tag grammar parity with the Convex resolvers", () => {
  // `convex/` cannot import from `src/`, so SAFE_TAG is necessarily duplicated.
  // This is the guard that keeps the two copies honest (R-3.1): a scanner that
  // accepts what the server rejects burns a round trip and shows the operator a
  // bare "not found" instead of "that isn't one of ours".
  const SOURCES = ["convex/scanLookup.ts", "convex/returnsLookup.ts"];

  it.each(SOURCES)("%s declares the same SAFE_TAG pattern and length cap", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("const SAFE_TAG = /^[A-Za-z0-9\\-_.:/ ]+$/");
    expect(source).toContain("length > 128");
  });
});
