/**
 * Live round-trip for the STOCKTAKE dual-write. Exercises the REAL mirror path —
 * create Prisma rows, call `syncStocktakeToConvex`, read the Convex copy back via
 * the service client — and proves:
 *
 *   1. a stocktake + its items mirror to Convex (parent fields + item count match).
 *   2. an item field UPDATE (scannedAt set) reflects in Convex.
 *   3. ★ a field reset to NULL (scannedAt → null, the unmark-found case) CLEARS in
 *      Convex — the replace-not-patch guard against silent staleness.
 *   4. an item DELETED from Prisma is removed from Convex (authoritative reconcile).
 *   5. `api.stocktakeMirror.sync` rejects a USER token (service-only write).
 *   6. `api.stocktakeDetail.version` is user-callable (org-scoped) and its vector
 *      MOVES on an in-place scan — the reactive-scanner trigger.
 *
 * Cleans up the synthetic stocktake/items in `finally` (Prisma + Convex).
 *
 * Requires: Convex backend up + Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-stocktake.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { createId } from "@paralleldrive/cuid2";
import { api } from "../convex/_generated/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { syncStocktakeToConvex, removeStocktakeFromConvex } from "@/lib/stocktake-mirror";
import { syncAssetsToConvex } from "@/lib/asset-mirror";

const URL = process.env.CONVEX_SELF_HOSTED_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

function nowExp(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds;
}
async function mint(payload: Record<string, unknown>): Promise<string> {
  const res = (await auth.api.signJWT({
    body: { payload: { exp: nowExp(300), ...payload } },
  })) as { token?: string } | null;
  if (!res?.token) throw new Error("signJWT returned no token");
  return res.token;
}

const results: boolean[] = [];
function check(label: string, ok: boolean, detail = "") {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  if (!URL) throw new Error("Convex URL not configured");

  const org = await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization to test against");
  const orgId = org.id;
  const location = await prisma.location.findFirst({ where: { organizationId: orgId }, select: { id: true } });
  if (!location) throw new Error("No location to attach a stocktake to");
  const member = await prisma.member.findFirst({ where: { organizationId: orgId }, select: { userId: true, role: true } });
  if (!member) throw new Error("No member to test against");

  const svc = await getConvexClient();
  const userToken = await mint({ sub: member.userId, orgId, role: member.role });
  const userClient = new ConvexHttpClient(URL);
  userClient.setAuth(userToken);

  const stId = `rt-st-${createId()}`;
  const item1Id = `rt-sti-${createId()}`;
  const item2Id = `rt-sti-${createId()}`;

  const getParent = () => svc.query(api.stocktakes.getById, { id: stId }) as Promise<Record<string, unknown> | null>;
  const getItems = () => svc.query(api.stocktakeItems.list, { stocktakeId: stId }) as Promise<Array<Record<string, unknown>>>;
  const ver = () => userClient.query(api.stocktakeDetail.version, { stocktakeId: stId }) as Promise<{ items: string } | null>;

  try {
    // (1) create a Prisma stocktake + 2 items, mirror it.
    await prisma.stocktake.create({
      data: {
        id: stId,
        organizationId: orgId,
        name: "Roundtrip Stocktake",
        locationId: location.id,
        scope: "FULL",
        status: "IN_PROGRESS",
        expectedCount: 2,
      },
    });
    await prisma.stocktakeItem.createMany({
      data: [
        { id: item1Id, stocktakeId: stId, expectedAtLocation: true, expectedQuantity: 1, found: false },
        { id: item2Id, stocktakeId: stId, expectedAtLocation: true, expectedQuantity: 1, found: false },
      ],
    });
    await syncStocktakeToConvex(stId);

    const p1 = await getParent();
    const i1 = await getItems();
    check("stocktake parent mirrors to Convex", !!p1 && p1.status === "IN_PROGRESS" && p1.expectedCount === 2, JSON.stringify(p1)?.slice(0, 50));
    check("both items mirror to Convex", i1.length === 2);

    const v0 = await ver();
    check("version() user-callable + org-scoped, returns a vector", v0 !== null, JSON.stringify(v0)?.slice(0, 40));

    // (2) update an item (scan it: found + scannedAt), mirror.
    await prisma.stocktakeItem.update({
      where: { id: item1Id },
      data: { found: true, foundQuantity: 1, scannedAt: new Date(), result: "MATCH" },
    });
    await syncStocktakeToConvex(stId);
    const i2 = await getItems();
    const scanned = i2.find((x) => x.id === item1Id);
    check("scanned item shows scannedAt in Convex", typeof scanned?.scannedAt === "number" && scanned?.found === true);

    const v1 = await ver();
    check("★ version vector MOVES on an in-place scan (reactive trigger)", !!v0 && !!v1 && v1.items !== v0.items);

    // (3) ★ reset scannedAt → null (unmark-found), mirror — Convex must CLEAR it.
    await prisma.stocktakeItem.update({
      where: { id: item1Id },
      data: { found: false, foundQuantity: 0, scannedAt: null, scannedById: null, result: "MATCH" },
    });
    await syncStocktakeToConvex(stId);
    const i3 = await getItems();
    const unscanned = i3.find((x) => x.id === item1Id);
    check("★ reset-to-null scannedAt CLEARS in Convex (replace not patch)", unscanned !== undefined && unscanned.scannedAt === undefined && unscanned.found === false);

    // (4) delete an item from Prisma, mirror — Convex reconcile removes it.
    await prisma.stocktakeItem.delete({ where: { id: item2Id } });
    await syncStocktakeToConvex(stId);
    const i4 = await getItems();
    check("deleted Prisma item is removed from Convex", i4.length === 1 && i4[0].id === item1Id);

    // (5) service-only: a USER token cannot call the mirror sync.
    let rejected = false;
    try {
      await userClient.mutation(api.stocktakeMirror.sync, {
        stocktake: { id: stId, organizationId: orgId, name: "x", locationId: location.id, scope: "FULL" },
        items: [],
      });
    } catch {
      rejected = true;
    }
    check("stocktakeMirror.sync rejects a user token (service-only)", rejected);

    // (6) ★ a JOINED asset rename moves the vector even though no stocktake_item
    // row changes — the cross-domain-join freshness the version now folds in.
    const asset = await prisma.asset.findFirst({ where: { organizationId: orgId }, select: { id: true, customName: true } });
    if (asset) {
      const origName = asset.customName;
      await prisma.stocktakeItem.update({ where: { id: item1Id }, data: { assetId: asset.id } });
      await syncStocktakeToConvex(stId);
      const va = await ver();
      try {
        await prisma.asset.update({ where: { id: asset.id }, data: { customName: `RT-${createId().slice(0, 6)}` } });
        await syncAssetsToConvex([asset.id]); // mirror ONLY the asset, not the stocktake
        const vb = await ver();
        check("★ joined asset rename moves the vector (no stocktake row changed)", !!va && !!vb && vb.items !== va.items);
      } finally {
        await prisma.asset.update({ where: { id: asset.id }, data: { customName: origName } }).catch(() => {});
        await syncAssetsToConvex([asset.id]).catch(() => {});
      }
    } else {
      console.log("⏭️  no asset in org — skipping joined-rename check");
    }
  } finally {
    await prisma.stocktakeItem.deleteMany({ where: { stocktakeId: stId } }).catch(() => {});
    await prisma.stocktake.delete({ where: { id: stId } }).catch(() => {});
    await removeStocktakeFromConvex(stId).catch(() => {});
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
