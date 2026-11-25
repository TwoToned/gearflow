// @vitest-environment node
import { describe, expect, test } from "vitest";
import { fileCategoryLabel, fileSizeLabel, guessFileCategory, matchesFileFilter } from "@/lib/file-category";

describe("guessFileCategory", () => {
  test("reads the file name first, then the type", () => {
    expect(guessFileCategory("Hilton floor plan v3.pdf", "application/pdf")).toBe("FLOOR_PLAN");
    expect(guessFileCategory("Risk assessment.docx", "application/msword")).toBe("RISK_ASSESSMENT");
    expect(guessFileCategory("PO-77812.pdf", "application/pdf")).toBe("CONTRACT");
    expect(guessFileCategory("stage.dwg", "application/octet-stream")).toBe("CAD");
    expect(guessFileCategory("IMG_0042.jpg", "image/jpeg")).toBe("PHOTO");
    expect(guessFileCategory("notes.txt", "text/plain")).toBe("OTHER");
  });
  test("labels are words, never the enum", () => {
    expect(fileCategoryLabel("CONTRACT")).toBe("Contract · PO");
    expect(fileCategoryLabel("WHATEVER")).toBe("Other");
  });
});

describe("filters and sizes", () => {
  test("Documents are non-images, Photos are images, All is everything", () => {
    expect(matchesFileFilter("image/png", "photos")).toBe(true);
    expect(matchesFileFilter("image/png", "documents")).toBe(false);
    expect(matchesFileFilter("application/pdf", "documents")).toBe(true);
    expect(matchesFileFilter("application/pdf", "all")).toBe(true);
  });
  test("size labels", () => {
    expect(fileSizeLabel(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(fileSizeLabel(10)).toBe("1 KB");
  });
});
