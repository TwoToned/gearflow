/**
 * #1233 (Phase 6, "Project versioning v2") — explicit "Done when" acceptance
 * criterion: prove there is NO code path that re-renders a sent quote's
 * bytes, not just that the ONE call site we know about (`finance-documents.
 * ts`'s `generateQuoteArtifact`) happens to behave. `finance-documents.
 * test.ts`'s "byte-identical on repeat download" test already proves the
 * BEHAVIOUR of that one call site; this file proves the STRUCTURE — that it
 * IS the only call site capable of producing a `docType: "quote"` render
 * that could be mistaken for (or wired into) the stored-artifact path.
 *
 * Two proofs, per CLAUDE.md's "how to prove a negative" guidance:
 *
 * 1. A grep-based sweep of every `generatePdf(...)` call site in `src/`
 *    (Node source, not test files) with `docType: "quote"` (or a bare
 *    `docType` variable that COULD be "quote", i.e. the generic warehouse-doc
 *    routes) — asserts the exhaustive, hand-reviewed list. A new call site
 *    added anywhere else fails this test until it's reviewed and added here
 *    deliberately, rather than silently opening a second render path.
 * 2. The download route (`/api/finance/quote/[quoteId]/pdf`) — the ACTUAL
 *    "view/download" path a user hits for a sent quote — never imports or
 *    calls `generatePdf`/`generateQuoteArtifact` at all; it only streams
 *    already-stored bytes (`streamStoredArtifact`). Proven by reading its
 *    source directly (not mocking it), so a future edit that quietly wires
 *    in a live render fails this test immediately.
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/** Strips `//` line comments and `/* ... *\/` block comments (docstrings
 *  mentioning `generatePdf()` in prose, e.g. "the one caller") so they don't
 *  register as real call sites. Not a full parser — good enough for this
 *  codebase's own source, which never puts a real `generatePdf(` call inside
 *  a string literal. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every non-test `.ts`/`.tsx` file under `src/` with a REAL (non-comment)
 *  `generatePdf(` call. */
function findGeneratePdfCallSites(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      if (full.endsWith(`${path.sep}generate-pdf.ts`)) continue; // the definition itself
      const code = stripComments(fs.readFileSync(full, "utf8"));
      if (/\bgeneratePdf\(/.test(code)) {
        hits.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return hits.sort();
}

describe("no code path re-renders a sent quote's bytes (#1233 Phase 6, #987)", () => {
  test("generatePdf's non-test call sites are EXACTLY the reviewed set — a new one fails this test until added deliberately", () => {
    const sites = findGeneratePdfCallSites();
    // Every one of these is hand-reviewed:
    //  - finance-documents.ts: the ONE artifact-render call site (quote +
    //    invoice), gated behind `attach*Artifact`'s never-overwrite guard.
    //  - route.tsx (`/api/documents/[projectId]`): quote/invoice types are
    //    PREVIEW-ONLY here (requires `?preview=1`, stamps the DRAFT PREVIEW
    //    watermark, never attaches/stores) — see the route's own guard.
    //  - documents.ts (MCP/API doc-fetch surface): same PREVIEW-ONLY /
    //    live-warehouse-doc posture as route.tsx, no storage attach anywhere
    //    in this file either.
    expect(sites).toEqual([
      "src/app/api/documents/[projectId]/route.tsx",
      "src/lib/api/documents.ts",
      "src/server/finance-documents.ts",
    ]);
  });

  test("route.tsx never renders a docType:\"quote\" WITHOUT the preview guard + watermark", () => {
    const text = read("src/app/api/documents/[projectId]/route.tsx");
    // The PREVIEW_ONLY_TYPES gate (400 unless ?preview=1) must still exist,
    // and the render call must still pass draftPreview for exactly those
    // types — if either disappears, this route would silently become a
    // live-render path for a type it isn't supposed to serve outside
    // preview, which is precisely the #987 invariant this test guards.
    expect(text).toMatch(/PREVIEW_ONLY_TYPES/);
    expect(text).toMatch(/draftPreview:\s*preview\s*&&\s*PREVIEW_ONLY_TYPES\.has\(docType\)/);
    // And it must never attach/store the result — no `attachQuoteArtifact`/
    // `attachInvoiceArtifact` call anywhere in this route.
    expect(text).not.toMatch(/attachQuoteArtifact|attachInvoiceArtifact/);
  });

  test("documents.ts's quote render is draftPreview-only — never stores a result", () => {
    const text = read("src/lib/api/documents.ts");
    expect(text).toMatch(/draftPreview:\s*true/);
    expect(text).not.toMatch(/attachQuoteArtifact|attachInvoiceArtifact/);
  });

  test("the quote download route streams STORED bytes only — no generatePdf/generateQuoteArtifact import or call", () => {
    const text = read("src/app/api/finance/quote/[quoteId]/pdf/route.ts");
    expect(text).not.toMatch(/generatePdf|generateQuoteArtifact/);
    // It must actually read `pdfFileId` and stream it — a no-op regex match
    // for the ABSENCE of a render call would also pass on a route that does
    // nothing useful at all, so also assert the positive: it streams a
    // stored artifact.
    expect(text).toMatch(/streamStoredArtifact/);
    expect(text).toMatch(/quote\.pdfFileId/);
  });

  test("financeArtifacts.attachQuoteArtifact (the only writer of quotes.pdfFileId) refuses to overwrite an existing one", () => {
    const text = read("convex/financeArtifacts.ts");
    const fn = text.slice(text.indexOf("export const attachQuoteArtifact"));
    // The never-overwrite guard: an early return before ANY `ctx.db.patch`
    // that would set `pdfFileId`, gated on the row already carrying one.
    expect(fn).toMatch(/if \(quote\.pdfFileId\) return \{ attached: false/);
  });
});
