import { describe, it, expect } from "vitest";
import {
  normalize,
  trigramSimilarity,
  includesLower,
  includesNorm,
  anyTagMatches,
  parseTerms,
  matchesQuery,
  bestSimilarity,
  TRIGRAM_THRESHOLD,
} from "../../../convex/lib/searchScore";

describe("searchScore — pure match/rank helpers (globalSearch parity)", () => {
  describe("normalize", () => {
    it("strips non-alphanumerics and lowercases", () => {
      expect(normalize("SM-58 Beta!")).toBe("sm58beta");
      expect(normalize("  Shure  ")).toBe("shure");
      expect(normalize("")).toBe("");
    });
  });

  describe("trigramSimilarity (pg_trgm-style Jaccard)", () => {
    it("is 1.0 for identical strings", () => {
      expect(trigramSimilarity("shure", "shure")).toBeCloseTo(1, 5);
    });
    it("is symmetric", () => {
      expect(trigramSimilarity("shure sm58", "sm58")).toBeCloseTo(
        trigramSimilarity("sm58", "shure sm58"),
        5,
      );
    });
    it("is 0 when a side is empty", () => {
      expect(trigramSimilarity("", "shure")).toBe(0);
      expect(trigramSimilarity("shure", "")).toBe(0);
    });
    it("ranks a closer typo above a distant string", () => {
      const close = trigramSimilarity("shure", "shrue"); // transposition
      const far = trigramSimilarity("shure", "yamaha");
      expect(close).toBeGreaterThan(far);
    });
    it("crosses the fuzzy threshold for a one-char typo, not for unrelated text", () => {
      expect(trigramSimilarity("microphone", "microphon")).toBeGreaterThan(TRIGRAM_THRESHOLD);
      expect(trigramSimilarity("microphone", "generator")).toBeLessThan(TRIGRAM_THRESHOLD);
    });
  });

  describe("substring / tag helpers", () => {
    it("includesLower matches case-insensitively, never on empty needle", () => {
      expect(includesLower("Shure SM58", "sm58")).toBe(true);
      expect(includesLower("Shure SM58", "SM58")).toBe(false); // needle must already be lowered
      expect(includesLower("Shure SM58", "")).toBe(false);
      expect(includesLower(null, "x")).toBe(false);
    });
    it("includesNorm matches across punctuation/spacing", () => {
      expect(includesNorm("SM-58", "sm58")).toBe(true);
      expect(includesNorm("Shure  SM 58", "sm58")).toBe(true);
      expect(includesNorm(undefined, "sm58")).toBe(false);
    });
    it("anyTagMatches checks each tag case-insensitively", () => {
      expect(anyTagMatches(["Vocal", "Wireless"], "wire")).toBe(true);
      expect(anyTagMatches(["Vocal"], "xyz")).toBe(false);
      expect(anyTagMatches(null, "x")).toBe(false);
    });
  });

  describe("matchesQuery (the SQL WHERE disjunction)", () => {
    const terms = parseTerms("sm58");
    it("matches on a raw ILIKE field", () => {
      expect(matchesQuery(terms, { ilikeFields: ["Shure SM58"], normFields: [], fuzzyFields: [] })).toBe(true);
    });
    it("matches on a normalized field across punctuation", () => {
      expect(matchesQuery(terms, { ilikeFields: [], normFields: ["SM-58"], fuzzyFields: [] })).toBe(true);
    });
    it("does NOT normalize a field that is only in ilikeFields (parity with the SQL split)", () => {
      // "SM-58" would match if normalized, but as an ILIKE-only field the hyphen breaks
      // the raw substring — mirrors the SQL only normalizing selected columns.
      expect(matchesQuery(terms, { ilikeFields: ["SM-58"], normFields: [], fuzzyFields: [] })).toBe(false);
    });
    it("matches on a tag", () => {
      expect(matchesQuery(terms, { ilikeFields: ["unrelated"], normFields: [], fuzzyFields: [], tags: ["sm58 clone"] })).toBe(true);
    });
    it("matches a fuzzy typo above threshold", () => {
      const t = parseTerms("microphone");
      expect(matchesQuery(t, { ilikeFields: ["nope"], normFields: [], fuzzyFields: ["microphon"] })).toBe(true);
    });
    it("does NOT match unrelated content", () => {
      expect(matchesQuery(terms, { ilikeFields: ["yamaha hs8"], normFields: ["yamaha hs8"], fuzzyFields: ["yamaha hs8"], tags: ["studio"] })).toBe(false);
    });
    it("ignores null/undefined fields safely", () => {
      expect(matchesQuery(terms, { ilikeFields: [null, undefined], normFields: [null], fuzzyFields: [null] })).toBe(false);
    });
  });

  describe("bestSimilarity (match_quality = GREATEST(similarity(...)))", () => {
    it("returns the max similarity across candidate fields", () => {
      const terms = parseTerms("shure");
      const q = bestSimilarity(terms, ["yamaha", "shure sm58", null]);
      expect(q).toBeGreaterThan(0);
      expect(q).toBe(bestSimilarity(terms, ["shure sm58"]));
    });
    it("returns 0 when nothing is similar", () => {
      expect(bestSimilarity(parseTerms("zzz"), ["yamaha", "generator"])).toBe(0);
    });
    it("orders an exact-ish field above a partial one", () => {
      const terms = parseTerms("shure");
      const exact = bestSimilarity(terms, ["shure"]);
      const partial = bestSimilarity(terms, ["shure microphone company ltd"]);
      expect(exact).toBeGreaterThan(partial);
    });
  });
});
