/**
 * Global-search validation harness (gate: "Convex search validated against real
 * queries — before the drop"). Repeatable + data-driven: derives real query terms
 * from live org data, asserts each entity is found, and checks the invariants that
 * must hold regardless of data (org isolation, no false positives, min-length).
 *
 * Search is `convex/globalSearch.ts` — org-scoped range scans (SCAN_CAP=5000) + a
 * pg_trgm-parity JS trigram/substring scorer (`convex/lib/searchScore.ts`). See
 * docs/convex-search-decision.md for the range-scan-vs-BM25 decision + SCAN_CAP.
 *
 *   docker exec <app> npx tsx scripts/validate-search.ts [orgId]
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type Result = { type: string; id: string; label?: string; title?: string; name?: string };

async function searchTop(orgId: string, query: string): Promise<Result[]> {
  const convex = await getConvexClient();
  const { results } = await convex.query(api.globalSearch.search, { orgId, query });
  return results as Result[];
}

async function firstRowName(orgId: string, table: string): Promise<{ id: string; name: string } | null> {
  const convex = await getConvexClient();
  const page = await convex.query(api.orgExport.exportTablePage, { table, orgId, cursor: null, numItems: 1 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (page.page as any[])[0];
  if (!row) return null;
  const name = row.name ?? row.title ?? row.assetTag ?? null;
  return name ? { id: row.id, name: String(name) } : null;
}

const failures: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures.push(msg);
};

async function main() {
  const orgId = process.argv[2];
  if (!orgId) throw new Error("Usage: validate-search.ts <orgId>");
  console.log(`Validating global search for org ${orgId}\n`);

  // ── Data-driven correctness: real entity → derived term → must be found ──────
  console.log("Data-driven (real entity name → search → found):");
  for (const table of ["models", "clients", "projects", "suppliers", "assets"]) {
    const row = await firstRowName(orgId, table);
    if (!row) {
      console.log(`  – ${table}: no rows, skipped`);
      continue;
    }
    // Use the FULL first word (≥2 alnum chars) as the term — specific enough that
    // the target entity ranks in the results (a short prefix can match many rows and
    // push the exact target below the per-entity result cap: a harness artifact, not
    // a search bug).
    const term = row.name.split(/\s+/).find((w) => w.replace(/[^a-zA-Z0-9]/g, "").length >= 2) ?? row.name;
    const q = term.replace(/[^a-zA-Z0-9]/g, "");
    const hits = await searchTop(orgId, q);
    const found = hits.some((h) => h.id === row.id);
    ok(found, `${table}: "${q}" (from "${row.name}") → ${hits.length} hits, target ${found ? "FOUND" : "MISSING"}`);
  }

  // ── Invariants (data-agnostic) ──────────────────────────────────────────────
  console.log("\nInvariants:");
  ok((await searchTop(orgId, "a")).length === 0, 'min-length: 1-char "a" → 0 results');
  ok((await searchTop(orgId, "zzqxjkwvbmp")).length === 0, 'no false positives: gibberish → 0 results');

  // Org isolation: a real term under a BOGUS org must return nothing (no cross-tenant leak).
  const realRow = await firstRowName(orgId, "models");
  if (realRow) {
    const term = realRow.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5);
    const leak = await searchTop("org_does_not_exist_zzz", term);
    ok(leak.length === 0, `org isolation: "${term}" under a bogus org → ${leak.length} results (expect 0)`);
  }

  // Latency sample
  await searchTop(orgId, "e");
  const t1 = Date.now();
  await searchTop(orgId, "pro");
  console.log(`\nLatency: ~${Date.now() - t1}ms (warm single-term scan across 15 entities).`);

  if (failures.length) {
    console.error(`\nSEARCH VALIDATION FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\nSEARCH VALIDATION OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
