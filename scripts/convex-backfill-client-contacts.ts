/**
 * WS9 #948 — expand-migrate backfill driver. See convex/backfillClientContacts.ts
 * and FEATUREDOCS/63-client-contacts.md.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-client-contacts.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-client-contacts.ts --apply  # writes
 *
 * Pages `clients` via api.backfillClientContacts.backfillClientContactsPage until
 * done, creating one primary `clientContacts` row for every client whose embedded
 * contact (contactName/contactEmail/contactPhone) carries any field and doesn't
 * already have a contact row. Idempotent — safe to re-run.
 *
 * A fresh Convex client is fetched per page so the short-lived service token can't
 * expire mid-run (mirrors convex-backfill-kit-units.ts).
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Client-contact backfill (WS9 #948)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write contacts)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  let page = 0;
  for (;;) {
    // Fresh client per page — the service token is short-lived.
    const convex = await getConvexClient();
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillClientContacts.backfillClientContactsPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `created ${r.created}` : `would create ${r.scanned}`} contact(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} client(s) with an embedded contact and no contact row found across ${page} page(s).`);
  if (apply) console.log(`✓ Created ${created} contact row(s).`);
  else console.log(`(Dry run — re-run with --apply to write ${scanned} contact row(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
