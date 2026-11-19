import { describe, it, expect } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("neutralises formula starts with a leading apostrophe", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe("\"'\rx\"");
    expect(csvCell("＝1")).toBe("'＝1");
  });
  it("leaves ordinary text alone and only guards the first character", () => {
    expect(csvCell("Main Stage")).toBe("Main Stage");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("")).toBe("");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("joins header and rows through csvCell", () => {
    expect(toCsv(["A", "B"], [["=x", "y,z"]])).toBe("A,B\n'=x,\"y,z\"");
  });
});
