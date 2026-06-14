/**
 * Backfill every existing stocktake (+ its items) into Convex via the same
 * `syncStocktakeToConvex` workhorse the live dual-write uses, so the backfill and
 * the runtime mirror can't diverge. Idempotent (reconcile) — safe to re-run; it
 * doubles as the heal path. See src/lib/stocktake-mirror.ts.
 *
 *   pnpm convex:backfill:stocktake
 */
import { prisma } from "@/lib/prisma";
import { syncStocktakeToConvex } from "@/lib/stocktake-mirror";

async function main() {
  const stocktakes = await prisma.stocktake.findMany({ select: { id: true } });
  console.log(`Backfilling ${stocktakes.length} stocktake(s) into Convex...`);

  let ok = 0;
  for (const st of stocktakes) {
    await syncStocktakeToConvex(st.id);
    ok++;
    if (ok % 20 === 0 || ok === stocktakes.length) {
      console.log(`  ${ok}/${stocktakes.length}`);
    }
  }

  console.log(`Done — ${ok}/${stocktakes.length} stocktakes synced.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
