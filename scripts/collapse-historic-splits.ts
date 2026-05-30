/**
 * Collapse historic split-sibling lines specifically.
 *
 * Pre-cutover, `splitLineItem` produced a distinctive shape we can
 * spot with high confidence and consolidate:
 *
 *   - ONE "priced parent" row: quantity > 0, unitPrice non-null,
 *     no assetId, lineTotal populated (the original commercial line)
 *   - N "child" rows: quantity = 1, unitPrice null OR 0, assetId set,
 *     lineTotal null OR 0 (peeled off by splitLineItem)
 *   - All rows share the same projectId, modelId, type, kitId,
 *     isKitChild, parentLineItemId, groupId/categoryId, supplier
 *     fields, isOptional, description, notes
 *
 * This script merges them by moving each child's assetId onto a
 * ProjectLineItemUnit attached to the canonical (priced) row, then
 * cancelling the child. The canonical's quantity stays — it already
 * accounted for the whole line; the children were qty=1 each and
 * their total was the canonical's qty.
 *
 * This is intentionally a *narrower* migration than
 * collapse-split-siblings.ts (which uses a strict full-equivalence
 * key and refuses anything divergent). Use this one for cleaning
 * historic split shrapnel; use the other for re-collapsing rows that
 * were duplicated commercially-identically.
 *
 * Dry-run by default. `--apply` to write. `--project <id>` to scope.
 *
 * Idempotent: re-running finds nothing to do.
 *
 * Usage:
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts                 # dry-run all
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts --project <id>  # one project
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts --apply         # writes
 *   tsx --env-file=.env scripts/collapse-historic-splits.ts --diagnose --project <id>
 *       # dump singletons + unmatched buckets so you can read the ids
 *
 * A project-scoped dry-run (`--project <id>` with no `--merge-into`) now
 * auto-dumps singletons + unmatched buckets with FULL line-item ids — so a
 * free-text priced parent that landed alone, and its scan-created children,
 * are both visible to copy straight into --merge-into / --children below.
 * No separate --diagnose pass needed when scoped to one project.
 *
 * Explicit merge (when parent + children share no FK — eg a free-text
 * priced parent with model-pinned scan children). Bypasses heuristics
 * and merges precisely the ids you name:
 *   tsx ... scripts/collapse-historic-splits.ts \
 *       --merge-into <canonicalId> --children <c1,c2,c3>            # dry-run
 *   tsx ... scripts/collapse-historic-splits.ts \
 *       --merge-into <canonicalId> --children <c1,c2,c3> --apply    # writes
 */

import { prisma } from "../src/lib/prisma";
import { syncLineItemRollup } from "../src/server/line-item-fulfillment";
import { nextOrdinal } from "../src/lib/line-item-units";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const diagnose = args.includes("--diagnose");
const projIdx = args.indexOf("--project");
const projectFilter = projIdx >= 0 ? args[projIdx + 1] : undefined;
// Explicit-merge mode: operator names the canonical row and the exact
// child ids (comma-separated) to fold into it. Bypasses all heuristics.
// This is the only safe way to consolidate splits whose parent and
// children share NO foreign key (eg a free-text priced parent,
// modelId=null, with scan-created model-pinned children — MUSE 260304).
const mergeIntoIdx = args.indexOf("--merge-into");
const canonicalIdArg = mergeIntoIdx >= 0 ? args[mergeIntoIdx + 1] : undefined;
const childrenIdx = args.indexOf("--children");
const childrenArg = childrenIdx >= 0 ? args[childrenIdx + 1] : undefined;
const runId = `historic-${new Date().toISOString().replace(/[:.]/g, "-")}`;

interface CandidateRow {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  parentLineItemId: string | null;
  quantity: number;
  unitPrice: { toString(): string } | null;
  lineTotal: { toString(): string } | null;
  discount: { toString(): string } | null;
  status: string;
  prepStatus: string | null;
  sortOrder: number;
  description: string | null;
  notes: string | null;
  groupId: string | null;
  categoryId: string | null;
  groupName: string | null;
  supplierId: string | null;
  subHireId: string | null;
  subHireItemId: string | null;
  subHireGroupId: string | null;
  isOptional: boolean;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  createdAt: Date;
}

/**
 * Order-level fields children must share with their canonical.
 *
 * Intentionally minimal for this NARROW historic-splits tool — we
 * already know the target shape (priced parent + qty=1 asset-pinned
 * children) and `splitLineItem` didn't preserve categorization or
 * notes on the children. Relaxing these fields lets the parent and
 * children land in the same bucket. The canonical's values (category,
 * group, notes, supplier, etc.) survive — children are deactivated.
 *
 * The strict full-equivalence key lives in
 * src/lib/split-sibling-collapse.ts (the other migration) and stays
 * conservative for the general case.
 */
function orderLevelKey(r: CandidateRow): string {
  return JSON.stringify({
    projectId: r.projectId,
    type: r.type,
    modelId: r.modelId,
    kitId: r.kitId,
    isKitChild: r.isKitChild,
    parentLineItemId: r.parentLineItemId,
    subHireId: r.subHireId,
    subHireItemId: r.subHireItemId,
    subHireGroupId: r.subHireGroupId,
    isContainerLineItem: r.isContainerLineItem,
    isCustomItem: r.isCustomItem,
    // Deliberately omitted (often differ between legacy parent + splits):
    //   description, notes, groupId, categoryId, groupName, supplierId,
    //   isOptional
  });
}

/** A row is "priced parent shaped": quantity > 1, unitPrice set, no assetId. */
function looksLikePricedParent(r: CandidateRow): boolean {
  const priceNum = r.unitPrice ? Number(r.unitPrice.toString()) : 0;
  return r.quantity >= 1 && priceNum > 0 && !r.assetId && !r.bulkAssetId;
}

/** A row is "split child shaped": qty=1, unitPrice 0/null, assetId set. */
function looksLikeSplitChild(r: CandidateRow): boolean {
  const priceNum = r.unitPrice ? Number(r.unitPrice.toString()) : 0;
  return r.quantity === 1 && priceNum === 0 && !!r.assetId && !r.isKitChild;
}

interface Group {
  key: string;
  canonical: CandidateRow;
  children: CandidateRow[];
}

async function main() {
  console.log("Collapse historic split-siblings (narrow mode)");
  console.log("─".repeat(60));
  console.log(`Mode:    ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (projectFilter) console.log(`Project: ${projectFilter}`);
  console.log(`Run id:  ${runId}`);
  console.log();

  const groups: Group[] = [];
  const flagged: { key: string; reason: string; rows: CandidateRow[] }[] = [];
  const unmatched: { key: string; rows: CandidateRow[]; reason: string }[] = [];
  // Optionally collect singletons too — useful when --diagnose is on so
  // the operator can see rows that DIDN'T cluster (eg a parent whose
  // categoryId differs from its children).
  const singletons: { key: string; rows: CandidateRow[] }[] = [];
  let bucketCount = 0;

  if (canonicalIdArg) {
    // ── Explicit merge mode ───────────────────────────────────────────
    // Trust the operator-supplied ids; validate hard, merge precisely
    // those rows. No bucketing, no shape heuristics. The validation
    // below is the only safety net, so it refuses anything sketchy:
    // missing rows, cross-project/cross-org children, kit children,
    // children with no assetId, or a cancelled canonical.
    const childIds = (childrenArg ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (childIds.length === 0) {
      console.error("ERROR: --merge-into requires --children <id1,id2,...>");
      process.exit(1);
    }
    const dupes = childIds.filter((id, i) => childIds.indexOf(id) !== i);
    if (dupes.length > 0) {
      console.error(`ERROR: duplicate child id(s): ${[...new Set(dupes)].join(", ")}`);
      process.exit(1);
    }
    if (childIds.includes(canonicalIdArg)) {
      console.error("ERROR: canonical id also appears in --children");
      process.exit(1);
    }
    const rows = (await prisma.projectLineItem.findMany({
      where: { id: { in: [canonicalIdArg, ...childIds] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })) as unknown as CandidateRow[];

    const canonical = rows.find((r) => r.id === canonicalIdArg);
    if (!canonical) {
      console.error(`ERROR: canonical line item not found: ${canonicalIdArg}`);
      process.exit(1);
    }
    if (canonical.status === "CANCELLED") {
      console.error(`ERROR: canonical ${canonicalIdArg} is CANCELLED — pick a live row`);
      process.exit(1);
    }
    if (projectFilter && canonical.projectId !== projectFilter) {
      console.error(`ERROR: canonical project ${canonical.projectId} != --project ${projectFilter}`);
      process.exit(1);
    }

    const children: CandidateRow[] = [];
    for (const cid of childIds) {
      const c = rows.find((r) => r.id === cid);
      if (!c) {
        console.error(`ERROR: child line item not found: ${cid}`);
        process.exit(1);
      }
      if (c.projectId !== canonical.projectId) {
        console.error(`ERROR: child ${cid} project (${c.projectId}) != canonical project (${canonical.projectId})`);
        process.exit(1);
      }
      if (c.organizationId !== canonical.organizationId) {
        console.error(`ERROR: child ${cid} org != canonical org`);
        process.exit(1);
      }
      if (c.isKitChild) {
        console.error(`ERROR: child ${cid} is a kit child — refusing`);
        process.exit(1);
      }
      if (!c.assetId) {
        console.error(`ERROR: child ${cid} has no assetId — explicit mode only merges serialised, asset-pinned children`);
        process.exit(1);
      }
      if (c.status === "CANCELLED") {
        console.log(`  (skip) child ${cid} already CANCELLED`);
        continue;
      }
      children.push(c);
    }
    if (children.length === 0) {
      console.error("ERROR: no live children to merge");
      process.exit(1);
    }

    const childQtySum = children.reduce((n, c) => n + c.quantity, 0);
    if (childQtySum > canonical.quantity) {
      console.log(
        `  WARNING: child qty sum (${childQtySum}) > canonical qty (${canonical.quantity}). ` +
        `Proceeding because ids were supplied explicitly — double-check this is intended.`,
      );
    }
    groups.push({ key: `explicit:${canonical.id}`, canonical, children });
    console.log("Mode:    EXPLICIT merge (operator-supplied ids)");
  } else {
    // ── Heuristic mode ────────────────────────────────────────────────
    const rows = (await prisma.projectLineItem.findMany({
      where: {
        ...(projectFilter ? { projectId: projectFilter } : {}),
        type: "EQUIPMENT",
        isKitChild: false,
        // Skip already-cancelled rows
        NOT: { AND: [{ status: "CANCELLED" }, { quantity: 0 }] },
      },
      orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    })) as unknown as CandidateRow[];

    // Bucket by order-level key. Rows with modelId=null are
    // intentionally bucketed into PER-ROW singletons (unique key per id)
    // rather than clustered together — multiple free-text lines share
    // modelId=null but are commercially unrelated, so collapsing them
    // would be a real bug. They still appear in the singletons dump so
    // a human can decide if any belong with another row.
    const byKey = new Map<string, CandidateRow[]>();
    for (const r of rows) {
      const k = r.modelId === null
        ? `__nullmodel:${r.id}` // unique-per-row → guaranteed singleton
        : orderLevelKey(r);
      const list = byKey.get(k);
      if (list) list.push(r);
      else byKey.set(k, [r]);
    }
    bucketCount = byKey.size;

    for (const [key, bucket] of byKey) {
      if (bucket.length < 2) {
        // Collect singletons when scoped to one project (bounded set) or
        // when --diagnose is on. This is how a priced parent that landed
        // ALONE — because its modelId is null (free-text) or differs from
        // its scan-created children — becomes visible, so the operator can
        // read its full id for the explicit --merge-into handoff. Skipped
        // on unscoped full runs to avoid dumping every line in the DB.
        if (diagnose || projectFilter) singletons.push({ key, rows: bucket });
        continue;
      }
      const parents = bucket.filter(looksLikePricedParent);
      const children = bucket.filter(looksLikeSplitChild);
      const others = bucket.filter(
        (r) => !looksLikePricedParent(r) && !looksLikeSplitChild(r),
      );
      if (parents.length === 0 || children.length === 0) {
        // In diagnose mode we surface these so the user can see why
        // their data didn't match the expected shape.
        unmatched.push({
          key,
          rows: bucket,
          reason: parents.length === 0
            ? "no row matches priced-parent shape (qty>=1, unitPrice>0, no assetId, no bulkAssetId)"
            : "no row matches split-child shape (qty=1, unitPrice=0/null, assetId set, not kit child)",
        });
        continue;
      }
      if (parents.length > 1) {
        flagged.push({
          key,
          reason: `${parents.length} priced parents (ambiguous canonical)`,
          rows: bucket,
        });
        continue;
      }
      if (others.length > 0) {
        flagged.push({
          key,
          reason: `${others.length} row(s) that aren't priced-parent or split-child shape`,
          rows: bucket,
        });
        continue;
      }
      // Sanity: total child qty should be ≤ parent qty (children are
      // peeled-off slices of the parent). If sum exceeds, something
      // funky happened — flag it.
      const childQtySum = children.reduce((n, c) => n + c.quantity, 0);
      if (childQtySum > parents[0].quantity) {
        flagged.push({
          key,
          reason: `child qty sum (${childQtySum}) > parent qty (${parents[0].quantity})`,
          rows: bucket,
        });
        continue;
      }
      groups.push({ key, canonical: parents[0], children });
    }
  }

  console.log(`Candidate buckets: ${bucketCount}`);
  console.log(`Mergeable groups:  ${groups.length}`);
  console.log(`Flagged:           ${flagged.length}`);
  console.log(`Unmatched buckets: ${unmatched.length}`);
  console.log();

  // Look up project + model labels up-front so both the diagnostic and
  // the merge plan output can show human-readable names.
  const allProjectIds = new Set<string>();
  const allModelIds = new Set<string>();
  const sourceRows: CandidateRow[] = [
    ...groups.flatMap((g) => [g.canonical, ...g.children]),
    ...flagged.flatMap((f) => f.rows),
    ...unmatched.flatMap((u) => u.rows),
    ...singletons.flatMap((s) => s.rows),
  ];
  for (const r of sourceRows) {
    allProjectIds.add(r.projectId);
    if (r.modelId) allModelIds.add(r.modelId);
  }
  const [allProjects, allModels] = await Promise.all([
    allProjectIds.size
      ? prisma.project.findMany({ where: { id: { in: [...allProjectIds] } }, select: { id: true, projectNumber: true, name: true } })
      : [],
    allModelIds.size
      ? prisma.model.findMany({ where: { id: { in: [...allModelIds] } }, select: { id: true, name: true } })
      : [],
  ]);
  const projById = new Map(allProjects.map((p) => [p.id, p]));
  const modelById = new Map(allModels.map((m) => [m.id, m]));

  const showSingletons =
    diagnose || (groups.length === 0 && flagged.length === 0);
  if (showSingletons && singletons.length > 0) {
    console.log("─── Singletons ───────────────────────────────────────────────");
    console.log("(Buckets that have only one row. A priced parent that landed");
    console.log(" alone (no children in the same bucket due to a differing");
    console.log(" modelId, categoryId, or other key field) shows up here. The");
    console.log(" `desc` field is the line's `description` text — fuzzy-match");
    console.log(" against it to find related rows.)");
    console.log();
    for (let i = 0; i < singletons.length; i++) {
      const s = singletons[i];
      const r = s.rows[0];
      const proj = projById.get(r.projectId);
      const model = r.modelId ? modelById.get(r.modelId) : null;
      const price = r.unitPrice ? r.unitPrice.toString() : "null";
      const total = r.lineTotal ? r.lineTotal.toString() : "null";
      const assetTag = r.assetId ? r.assetId.slice(0, 8) + "…" : "—";
      const desc = (r.description ?? "").slice(0, 40);
      const modelName = model?.name ?? (r.modelId ? "?" : "(no model)");
      // FULL id (not truncated) — this dump is meant to be read off and
      // pasted into --merge-into / --children for the explicit merge.
      console.log(
        `  ${r.id}  ${proj?.projectNumber ?? "?"}  model=${modelName}  desc="${desc}"  qty=${r.quantity}  price=${price}  total=${total}  assetId=${assetTag}  status=${r.status}`,
      );
    }
    console.log();
  }
  if (diagnose || (groups.length === 0 && flagged.length === 0 && unmatched.length > 0)) {
    console.log("─── Unmatched bucket diagnostics ─────────────────────────────");
    console.log("(Buckets where rows shared an order-level key but didn't fit");
    console.log(" the priced-parent + split-child shape. Useful for tuning the");
    console.log(" detection heuristics for this data set.)");
    console.log();
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      console.log(`[bucket ${i + 1}/${unmatched.length}] ${u.reason}`);
      for (const r of u.rows) {
        const proj = projById.get(r.projectId);
        const model = r.modelId ? modelById.get(r.modelId) : null;
        const price = r.unitPrice ? r.unitPrice.toString() : "null";
        const total = r.lineTotal ? r.lineTotal.toString() : "null";
        const assetTag = r.assetId ? r.assetId.slice(0, 8) + "…" : "—";
        const bulkTag = r.bulkAssetId ? r.bulkAssetId.slice(0, 8) + "…" : "—";
        const cat = r.categoryId ? r.categoryId.slice(0, 8) + "…" : "—";
        const grp = r.groupId ? r.groupId.slice(0, 8) + "…" : "—";
        // FULL line-item id — these are the child ids to paste into
        // --children for the explicit merge.
        console.log(
          `  ${r.id}  ${proj?.projectNumber ?? "?"}  ${model?.name ?? "?"}  qty=${r.quantity}  price=${price}  total=${total}  assetId=${assetTag}  bulkId=${bulkTag}  status=${r.status}  cat=${cat}  group=${grp}  kitChild=${r.isKitChild}  parent=${r.parentLineItemId ? r.parentLineItemId.slice(0, 8) + "…" : "—"}`,
        );
      }
      console.log();
    }
  }

  if (flagged.length > 0) {
    console.log("Flagged groups (NOT merged):");
    for (const g of flagged) {
      console.log(`  - ${g.reason}`);
      for (const r of g.rows) {
        const price = r.unitPrice ? r.unitPrice.toString() : "null";
        const asset = r.assetId ? "asset" : r.bulkAssetId ? "bulk" : "none";
        console.log(`      ${r.id} qty=${r.quantity} unitPrice=${price} ${asset} status=${r.status}`);
      }
    }
    console.log();
  }

  let touched = 0;
  let unitsMoved = 0;
  let checkRecordsRepointed = 0;
  let damageEventsRepointed = 0;

  for (const g of groups) {
    const proj = projById.get(g.canonical.projectId);
    const model = g.canonical.modelId ? modelById.get(g.canonical.modelId) : null;
    const canonLabel = model?.name ?? (g.canonical.description ?? "(no model/desc)");
    console.log(
      `  ${apply ? "MERGE" : "PLAN "}  ${proj?.projectNumber ?? "?"}  ${canonLabel}  canonical=${g.canonical.id} qty=${g.canonical.quantity} price=${g.canonical.unitPrice ? g.canonical.unitPrice.toString() : "null"} status=${g.canonical.status}  merging ${g.children.length} child(ren)`,
    );
    for (const c of g.children) {
      console.log(`         ← ${c.id} qty=${c.quantity} asset=${c.assetId} status=${c.status}`);
    }
    if (apply) {
      await mergeGroup(g);
      touched += g.children.length;
      unitsMoved += g.children.length;
    }
  }

  console.log();
  console.log("Summary");
  console.log("─".repeat(60));
  console.log(`  Mergeable groups:        ${groups.length}`);
  console.log(`  Flagged groups:          ${flagged.length}`);
  console.log(`  Children ${apply ? "merged" : "would merge"}: ${apply ? touched : groups.reduce((n, g) => n + g.children.length, 0)}`);
  if (apply) {
    console.log(`  Units moved:             ${unitsMoved}`);
    console.log(`  CheckRecords repointed:  ${checkRecordsRepointed}`);
    console.log(`  DamageEvents repointed:  ${damageEventsRepointed}`);
  } else {
    console.log();
    console.log("Re-run with --apply to execute.");
  }

  async function mergeGroup(g: Group) {
    await prisma.$transaction(async (tx) => {
      const canonicalUnits = await tx.projectLineItemUnit.findMany({
        where: { lineItemId: g.canonical.id },
        select: { ordinal: true },
      });
      const used = new Set(canonicalUnits.map((u) => u.ordinal));

      for (const child of g.children) {
        // Each split child has assetId set + quantity=1 — make a unit
        // on the canonical with that assetId. Reuse if there's already
        // one (defensive vs re-runs).
        const existingUnit = await tx.projectLineItemUnit.findUnique({
          where: {
            lineItemId_assetId: {
              lineItemId: g.canonical.id,
              assetId: child.assetId!,
            },
          },
          select: { id: true },
        });
        let unitId: string;
        if (existingUnit) {
          unitId = existingUnit.id;
        } else {
          // Find a free ordinal.
          let ord = nextOrdinal([...used].map((o) => ({ ordinal: o })));
          while (used.has(ord)) ord += 1;
          used.add(ord);
          // Inherit the child's per-unit state (so a deployed split
          // becomes a deployed unit; a returned split becomes a
          // returned unit). Safe defaults if the child was just
          // CONFIRMED.
          const status = child.status;
          const unit = await tx.projectLineItemUnit.create({
            data: {
              organizationId: child.organizationId,
              lineItemId: g.canonical.id,
              ordinal: ord,
              assetId: child.assetId,
              quantity: 1,
              status: status === "PREPPED" || status === "QUOTED"
                ? "CONFIRMED"
                : (status as "CONFIRMED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED"),
              prepStatus: child.prepStatus as "PENDING" | "PULLED" | "FLAGGED_FAULTY" | "FLAGGED_TT_OVERDUE" | "PACKED" | null,
            },
            select: { id: true },
          });
          unitId = unit.id;
        }

        // Repoint CheckRecord rows that point at the split.
        const cr = await tx.checkRecord.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id, lineItemUnitId: unitId },
        });
        checkRecordsRepointed += cr.count;

        // Repoint DamageEvent rows.
        const de = await tx.damageEvent.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id, lineItemUnitId: unitId },
        });
        damageEventsRepointed += de.count;

        // ProjectService 1:1 (if any).
        await tx.projectService.updateMany({
          where: { lineItemId: child.id },
          data: { lineItemId: g.canonical.id },
        });

        // Audit row — same table as the strict collapse migration.
        await tx.lineItemMergeMap.create({
          data: {
            organizationId: child.organizationId,
            oldLineItemId: child.id,
            canonicalLineItemId: g.canonical.id,
            movedUnitId: unitId,
            checkRecordsRepointed: cr.count,
            damageEventsRepointed: de.count,
            notes: `${runId} | historic-splits | parent qty=${g.canonical.quantity} child qty=${child.quantity}`,
          },
        });

        // Deactivate the split.
        await tx.projectLineItem.update({
          where: { id: child.id },
          data: {
            assetId: null,
            bulkAssetId: null,
            quantity: 0,
            status: "CANCELLED",
            notes: `[merged into ${g.canonical.id} on ${new Date().toISOString()} (${runId})]`,
          },
        });
      }

      // No quantity change to canonical — its quantity already
      // represented the whole line. Just recompute rollup.
      await syncLineItemRollup(tx, g.canonical.id);
    });
  }
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
