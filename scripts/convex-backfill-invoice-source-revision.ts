/**
 * #1080/#1097 (Phase 4 — version list + invoice lineage) backfill driver.
 * See `convex/backfillInvoiceSourceRevision.ts` for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-invoice-source-revision.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-invoice-source-revision.ts --apply  # writes
 *
 * BEST-EFFORT, not a correctness dependency — a pre-#1097 invoice with no
 * `sourceRevision` already renders correctly under the project ledger with no
 * version chip ("we genuinely don't know which version produced it"). Pages
 * the `invoices` table via
 * `api.backfillInvoiceSourceRevision.backfillInvoiceSourceRevisionPage` until
 * done, then re-verifies via `verifyInvoiceSourceRevision`. Unlike the
 * `liveRevision` backfill this one does NOT hard-fail on leftovers — an
 * invoice whose project couldn't be resolved (should not happen) legitimately
 * stays unattributed rather than getting a guessed number. Idempotent — safe
 * to re-run; a second run reports 0 work. A fresh Convex client is fetched
 * per page so the short-lived service token can't expire mid-run.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function runVerification(): Promise<{ totalInvoices: number; invoicesMissingSourceRevision: number }> {
  let totalInvoices = 0;
  let invoicesMissingSourceRevision = 0;
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const r: {
      totalInvoices: number;
      invoicesMissingSourceRevision: number;
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.backfillInvoiceSourceRevision.verifyInvoiceSourceRevision, { cursor });
    totalInvoices += r.totalInvoices;
    invoicesMissingSourceRevision += r.invoicesMissingSourceRevision;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { totalInvoices, invoicesMissingSourceRevision };
}

async function main() {
  console.log("invoices.sourceRevision (#1097) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will stamp sourceRevision)" : "dry-run"}`);
  console.log();

  const before = await runVerification();
  console.log(`Before: ${before.totalInvoices} invoice(s), ${before.invoicesMissingSourceRevision} missing sourceRevision.`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  let skippedNoProject = 0;
  let page = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: { scanned: number; updated: number; skippedNoProject: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillInvoiceSourceRevision.backfillInvoiceSourceRevisionPage, { cursor, apply });
    scanned += r.scanned;
    updated += r.updated;
    skippedNoProject += r.skippedNoProject;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `stamped ${r.updated}` : `would stamp ${r.scanned}`} invoice(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} invoice(s) missing sourceRevision found across ${page} page(s).`);
  if (skippedNoProject > 0) {
    console.log(`⚠ ${skippedNoProject} invoice(s) had no resolvable project — left unattributed.`);
  }
  if (!apply) {
    console.log(`(Dry run — re-run with --apply to stamp ${scanned} invoice(s).)`);
    return;
  }
  console.log(`✓ Stamped ${updated} invoice(s).`);

  const after = await runVerification();
  console.log();
  console.log(`After: ${after.invoicesMissingSourceRevision} invoice(s) still missing sourceRevision.`);
  console.log(
    after.invoicesMissingSourceRevision === 0
      ? "✓ Verified — every invoice has a sourceRevision."
      : "This is expected only if some invoices' projects couldn't be resolved — see the warning above.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
