# Off-inventory unit ("Prep as custom item") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click converts an unassigned unit of an overbooked serialised-model line into an off-inventory ("custom") unit that stays on the line, keeps its price, and stops counting as stock demand.

**Architecture:** A single new line field `projectLineItems.offInventoryQuantity` is the sole source of truth. Stock demand everywhere uses `stockBackedQty(line) = max(0, quantity − offInventoryQuantity)`. Converting also inserts one generic (asset-less) unit, which the existing fulfilment/scan code already treats as an assigned, manually-ticked unit.

**Tech Stack:** Convex (`convex-test`, vitest), Next.js 16, React, Radix UI, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-28-off-inventory-unit-design.md`

## Global Constraints

- pnpm only (`pnpm exec`, never `npx`); no Convex push — verify with `pnpm test`.
- `throw new ConvexError(...)`, never `Error`, in `convex/*.ts`.
- Convex can't import from `src/`; `src/` MAY import from `convex/lib/*`. The helper therefore lives in `convex/lib/stockBackedQty.ts` and is imported by both.
- Browser-direct mutation pattern: `*Core` in `convex/warehouseOps.ts`, wrapper in `convex/warehouseWrites.ts` (`assertWritesEnabled("warehouse")`, `enforceBrowserWriteLimit`, `requireOrgPermission(ctx, orgId, "warehouse", "check_out")`, `resolveActor`, boundary org checks, `writeActivityLog`).
- Every doc fetched via a global index (`by_cuid`) is org-checked.
- After touching registry inputs: `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp` and commit all three outputs.
- Atomic commits; commit trailers per the session attribution reminder.
- Docs (FEATUREDOCS + CLAUDE.md) updated in the same PR.

## Review Focus

- Line with every unit converted (qty 3, 3 custom): demand 0, no division/negative anywhere.
- Convert on a bulk-backed or non-serialised model line: rejected, not silently accepted.
- Convert when no free slot (all units already have serials): rejected with a clear message.
- Quantity patched below `offInventoryQuantity`: rejected.
- Convert-back when the custom unit is already deployed: rejected; pending/prepped ones removed.
- Cross-org `lineItemId`: rejected (IDOR).

---

### Task 1: Field plumbing + `stockBackedQty`

**Files:**
- Create: `convex/lib/stockBackedQty.ts`, `convex/lib/stockBackedQty.test.ts`
- Modify: `convex/schema.ts` (~L1650, beside `assignedQuantity`), `convex/projectLineItems.ts` (the four return validators at ~L173/243/324/410 — add beside `assignedQuantity`), `src/lib/project-line-item-read.ts` (Pick list ~L127, interface ~L210, mapper ~L284), `src/lib/project-equipment-reconstruct.ts` (interface ~L209, mapper ~L283)

**Interfaces:**
- Produces: `stockBackedQty(line: { quantity?: number | null; offInventoryQuantity?: number | null }): number` = `Math.max(0, (quantity ?? 0) − (offInventoryQuantity ?? 0))`. Read shapes expose `offInventoryQuantity: number` (default 0).

- [ ] **Step 1: Write failing test** `stockBackedQty.test.ts`: `stockBackedQty({quantity:3, offInventoryQuantity:1}) === 2`; absent counter → 3; `{quantity:3, offInventoryQuantity:3} → 0`; counter > quantity → 0; null quantity → 0.
- [ ] **Step 2:** `pnpm exec vitest run convex/lib/stockBackedQty.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the helper; add `offInventoryQuantity: v.optional(v.number())` to the schema and the four `projectLineItems.ts` validators; thread `offInventoryQuantity` (`d.offInventoryQuantity ?? 0`) through both read mappers.
- [ ] **Step 4:** Run the helper test → PASS; `pnpm exec tsc --noEmit` → no new errors.
- [ ] **Step 5: Commit** `feat(line-items): offInventoryQuantity field + stockBackedQty helper`.

### Task 2: Demand sites use `stockBackedQty`

**Files:**
- Modify: `convex/lib/availabilityCore.ts` (~L253 booked sum), `convex/availability.ts` (booking rows ~L72/L149), `convex/lib/overbookingBoard.ts` (`BoardLineItem` + `applyDemandLine` ~L203), `src/lib/overbooking-core.ts` (`bumpTotal`/`bumpClaim` ~L353), and every other site the audit finds
- Test: `convex/offInventoryDemand.test.ts`

**Interfaces:**
- Consumes: `stockBackedQty` from Task 1. `BoardLineItem` gains `offInventoryQuantity?: number | null`.

- [ ] **Step 1: Audit.** Run `grep -rn "\.quantity" convex/lib/overbooking*.ts convex/lib/projectReadiness.ts convex/overbooking*.ts convex/availability*.ts convex/lib/availability*.ts src/lib/overbooking-core.ts src/lib/equipment-tab-reconstruct.ts src/lib/project-detail-reconstruct.ts` and list each that sums line quantity as **stock demand** (not price/display). Record the list in the commit message.
- [ ] **Step 2: Write failing tests** in `offInventoryDemand.test.ts` (convex-test): seed a model with 2 serialised assets and a CONFIRMED project with one line `quantity: 3`. With `offInventoryQuantity` absent, `overbookingBoard.bundle` reports the model hard-overbooked by 1 and `availability.computeModelAvailability` reports `booked: 3`. With `offInventoryQuantity: 1`, board has no overbooked row for the model and `booked === 2`, `available === 0`. Add the same assertion for `overbookingBoard.confirmImpact` (no model rows) and for `reconstructOverbookedStatus` in `src/lib/overbooking-core.test.ts` (map has no entry for the line).
- [ ] **Step 3:** Run them → FAIL.
- [ ] **Step 4:** Replace each audited demand sum with `stockBackedQty(li)`; add the field to the `ConvexLineItem`/`BoardLineItem` shapes those sites read.
- [ ] **Step 5:** Run new tests plus `pnpm exec vitest run convex/overbooking convex/lib/overbooking src/lib/overbooking-core.test.ts convex/availability` → PASS.
- [ ] **Step 6: Guard test** `convex/stockBackedQtyGuard.test.ts`: for each audited file, `readFileSync` and assert it contains `stockBackedQty`. Commit `feat(availability): off-inventory units don't count as stock demand`.

### Task 3: Core mutations, prep flip, quantity guard

**Files:**
- Modify: `convex/warehouseOps.ts` (add cores near `reassignSerialisedUnitCore`, ~L2035), `convex/lib/fulfillment.ts` (`prepUnit` generic branch ~L1162), `convex/lineItemWrites.ts` (`patchNative` quantity handling ~L693)
- Test: `convex/offInventoryUnit.test.ts`

**Interfaces:**
- Produces in `warehouseOps.ts`:
  - `convertUnitToOffInventoryCore(ctx: Ctx, a: { organizationId: string; projectId: string; lineItemId: string; prep: boolean; now: number }): Promise<{ unitId: string; offInventoryQuantity: number }>`
  - `convertUnitBackToInventoryCore(ctx: Ctx, a: { organizationId: string; projectId: string; lineItemId: string; now: number }): Promise<{ offInventoryQuantity: number }>`

- [ ] **Step 1: Write failing tests** in `offInventoryUnit.test.ts` (convex-test, org/project/model/asset fixtures like `convex/kitPerUnit.test.ts`):
  - convert on `quantity: 3` line (2 serialised units assigned? no — 0 assigned): counter 1, exactly one unit row with no `assetId`/`bulkAssetId`, `quantity 1`; `prep: true` → `prepStatus "PACKED"`, line `packedQuantity 1`; `prep: false` → `"PENDING"`.
  - rejections (`ConvexError`): kit child, `type: "SALE"`, sub-hire line, bulk-backed model line, cross-org `lineItemId`, cancelled line, and no free slot (`quantity 2`, 2 assets assigned).
  - convert back: removes the unit, counter 0; with the custom unit `CHECKED_OUT` → rejects; with counter 0 → rejects.
  - `prepUnit` generic branch on a line holding a PENDING generic unit flips it to PACKED and creates no extra unit.
  - `patchNative` with `quantity` below `offInventoryQuantity` rejects with a message containing "convert".
  - scan spare capacity: after converting 1 of `quantity 2`, `assignedQuantity (1) < quantity (2)` still true, but after converting 2 of 2, false.
- [ ] **Step 2:** `pnpm exec vitest run convex/offInventoryUnit.test.ts` → FAIL.
- [ ] **Step 3:** Implement both cores (loaders: `lineByCuid`/`lineUnits` already in `warehouseOps.ts`/`fulfillment.ts`; free-slot rule per the spec; insert the unit with `createId()`, `ordinal: nextOrdinal(siblings)`, `status "CONFIRMED"`, `returnedQuantity 0`; finish with `syncLineItemRollup`). Add the PENDING-flip pre-step to `prepUnit`'s generic branch. Add the quantity-below-counter `ConvexError` in `patchNative`.
- [ ] **Step 4:** Run the file → PASS; `pnpm exec vitest run convex/warehouse convex/lineItem` → no regressions.
- [ ] **Step 5: Commit** `feat(warehouse): convert a unit to off-inventory and back`.

### Task 4: Browser-direct wrappers, hook, API surface

**Files:**
- Modify: `convex/warehouseWrites.ts` (wrappers beside `reassignLineItemUnit` ~L763; `agentOps` ~L1413), `src/hooks/use-warehouse-writes.ts` (~L59 and ~L431), generated: `src/lib/api/registry.generated.ts`, `src/lib/api/openapi.generated.ts`, `src/lib/api/llms-txt.generated.ts`, `src/lib/api/mcp-manifest.generated.ts`, `convex/_generated/api.d.ts` only if a new module is added (it is not)
- Test: extend `convex/offInventoryUnit.test.ts`

**Interfaces:**
- Produces: `warehouseWrites.convertUnitToOffInventory` args `{ orgId, projectId, lineItemId, prep: boolean, auditId, now, actor }`; `warehouseWrites.convertUnitBackToInventory` args `{ orgId, projectId, lineItemId, auditId, now, actor }`. Hook: `warehouseWrites.convertUnitToOffInventory(projectId, lineItemId, prep)` and `.convertUnitBackToInventory(projectId, lineItemId)`.

- [ ] **Step 1: Write failing tests**: a caller in org B invoking the wrapper with org A's `lineItemId` (`orgId: B`) throws; a caller without `warehouse:check_out` throws; success writes one `activityLog` row with the line's project.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement wrappers (`requireProjectInOrg`, `requireLineInProject`, then the core, then `writeActivityLog` with summary "Converted 1 {model/line} to a custom item" / "…back to inventory"); add `convertUnitToOffInventory: { danger: "medium" }` and `convertUnitBackToInventory: { danger: "low" }` to the module's `agentOps`; add the two hook methods mirroring `reassignLineItemUnit`.
- [ ] **Step 4:** Run the tests → PASS. Run `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp`, then `pnpm run api:registry:check` → clean.
- [ ] **Step 5: Commit** `feat(api): off-inventory unit wrappers + regenerated contracts`.

### Task 5: UI — warehouse (primary) and Equipment tab

**Files:**
- Modify: `src/components/warehouse/pick-prep-tab.tsx` (line row actions), `src/app/(app)/warehouse/[projectId]/page.tsx` (handlers wired to `useWarehouseWrites`), `src/components/projects/equipment-rows.tsx` (kebab ~L1440 + badge area ~L1409), `src/components/projects/equipment-row-types.ts` and `src/components/warehouse/warehouse-types.ts` (field in item types)
- Test: `src/components/warehouse/__tests__/off-inventory-action.smoke.test.tsx`, `src/components/projects/__tests__/off-inventory-menu.smoke.test.tsx`

**Interfaces:**
- Consumes: hook methods from Task 4; `OverbookedInfo`; `item.offInventoryQuantity`.

- [ ] **Step 1: Write failing smoke tests** (jsdom, actually open the control): warehouse row for an overbooked line with a free slot shows "Prep as custom item" and clicking calls `convertUnitToOffInventory(projectId, lineId, true)`; row with `offInventoryQuantity: 1` shows "1 custom" and "Convert back"; the Equipment-tab kebab (opened) lists "Convert 1 to custom item" only when overbooked and "Convert 1 back to inventory" only when the counter > 0. Wrap in `TooltipProvider` where tooltips render.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: show the action only for plain model lines (not kit child/sale/sub-hire/custom/container) with a free slot (`quantity − offInventoryQuantity − assignedQuantity-of-serialised ≥ 1`, computed from the row's existing fields) and `OverbookedInfo` present; toast on success/failure via existing `showError`; "N custom" `Badge status="neutral"` beside the existing `Custom` badge area.
- [ ] **Step 4:** Run both smoke tests → PASS; `pnpm lint` on touched files.
- [ ] **Step 5: Commit** `feat(ui): prep as custom item from warehouse and equipment tab`.

### Task 6: Docs and full verification

**Files:**
- Modify: `FEATUREDOCS/11-availability.md`, `FEATUREDOCS/12-warehouse.md`, `FEATUREDOCS/60-assets-on-a-job.md`, `FEATUREDOCS/65-overbookings-gaps-board.md`, `CLAUDE.md` (short "off-inventory units" convention note: line counter is the single source; demand goes through `stockBackedQty`; generic unit is the fulfilment side)

- [ ] **Step 1:** Update the docs per the spec's Docs section.
- [ ] **Step 2:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` → all green.
- [ ] **Step 3: Commit** `docs: off-inventory units`; push `claude/focused-thompson-uk0iur` and open a draft PR.
