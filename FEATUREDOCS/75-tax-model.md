# Tax Model — Client Exemption + Per-Line Rate Override

**Source:** T3 (#1091), part of the multi-tenant/internationalisation program (#1063/#1066).
**Design:** [`docs/designs/tax-model.md`](../docs/designs/tax-model.md) — this doc records what
actually shipped; read the design doc for the full reasoning (equivalence gate, EU multi-rate
rendering rationale, why US jurisdiction tables are explicitly out of scope).
**Depends on:** T1 (#1088, merged — no hardcoded AU GST fallback).
**Related:** [FEATUREDOCS/66](./66-finance-quotes-invoices-xero.md) (stored-bytes rule),
[FEATUREDOCS/67](./67-sales-line-items.md).

## What changed

Tax used to be one flat `project.taxRate ?? orgSettings.defaultTaxRate ?? 0` applied to the whole
taxable subtotal. Three things now sit in front of that:

1. **A client can be marked tax-exempt.** `clients.taxExempt` (boolean) +
   `clients.taxExemptReason` (free text, e.g. "Government purchase order #4471"). When set, the
   ENTIRE project's tax is zero — a hard short-circuit, never combined with any rate below.
2. **Any line item can override the rate it's taxed at.** New `projectLineItems.taxRate` column
   (0–100, optional). Resolution order, most-specific-wins: `line.taxRate ?? project.taxRate ??
   orgSettings.defaultTaxRate ?? 0`.
3. **The tax status is a tri-state, computed and persisted, never re-derived by the document
   layer:** `EXEMPT` (client flag fired), `UNSET` (nothing configured anywhere in the cascade —
   the only condition for this state), `COMPUTED` (a real resolved rate, including a deliberate
   explicit `0%`).

Groups and services have **no rate field of their own** (deliberately out of scope, same as the
design doc's §3.4) — a priced group's bundle and every service fall through to the
project/org "fallback rate." `SALE`-type line items get the per-line `taxRate` "for free" since
they share `projectLineItems` with equipment lines.

## Recalc engine (`convex/lib/recalc.ts`)

`recalcProjectTotals` now:

1. Looks up the project's client (if any) and short-circuits to `taxStatus: "EXEMPT"` /
   `taxAmount: 0` when `client.taxExempt` is true — before anything else runs.
2. Otherwise builds a list of **taxable-base contributions** — one per revenue-bearing unit
   (`buildTaxContributions`), tagged with that unit's *resolved* rate. The predicates
   (`isGroupCustomExtra`/`isStandaloneNonSale`/`isGroupedSubHire`/`isStandaloneSale`) mirror the
   EXACT filters already used for `groupRevenue`/`standaloneRevenue`/`subHireGroupedRevenue`/
   `saleRevenue` above them in the same file — kept in sync deliberately, so
   `Σ contributions.amount == subtotal`.
3. If no rate is configured anywhere (`anyRateConfigured` — checked across `project.taxRate`,
   `orgDefaultTaxRate`, and every line's own `taxRate`), status is `UNSET` and tax is zero — an
   absence, not a deliberate zero-rate determination.
4. Otherwise (`computeTaxOutcome`) contributions are grouped by rate, each group's taxable base is
   the **already-rounded** `taxableAmount` distributed proportionally by `contribution.amount ×
   (taxableAmount / subtotal)` (not by re-deriving `1 - discountPercent/100` independently) — this
   guarantees a single-rate project reproduces the pre-T3 flat computation to the cent. That
   equivalence is the correctness gate: `convex/recalc.test.ts`'s original 14 tests pass
   unmodified, plus 9 new tests covering mixed rates, per-line override precedence, org-default
   fallback, UNSET vs. explicit-0% COMPUTED, and client exemption overriding even a 25% line rate.
5. Persists `taxAmount`/`taxStatus`/`taxBreakdown` (JSON array of `{rate, amount}`, descending by
   rate) onto the project row — all three are recalc OUTPUTS, stripped from client patches via
   `PROJECT_MONEY_ANCHORS` (`projectWrites.ts`), same as every other derived money field.

The per-group/per-line taxable-base building and the EXEMPT/UNSET/COMPUTED resolution are each
split into their own top-level functions (`buildTaxContributions`, `computeTaxOutcome`, plus the
four line predicates) rather than inlined into `recalcProjectTotals` — R-3.6 (cyclomatic
complexity ≤ 10 per function); the loops/conditionals needed for grouping would otherwise have
pushed the parent function's complexity well past threshold.

## Locks and guards

- `projectLineItems.taxRate` bounds (0–100) are enforced in `assertLineMoneyFields`
  (`convex/lib/moneyGuards.ts`), mirroring the existing `project.taxRate` check.
- `clients.taxExemptReason` gets the same `assertStrLen(…, { max: 500 })` treatment every other
  free-text client field gets in `clientWrites.ts`.
- `taxRate` was added to `LOCKED_LINE_ITEM_FIELDS` (`convex/lib/projectLocks.ts`) alongside
  `unitPrice`/`discount`/`discountMode`/`duration` — a tax-rate patch under a lifecycle lock
  triggers the FINANCIAL unlock-session gate, not the lesser structural JUSTIFY gate. Every
  add-mutation code path that drops `discount`/`discountMode` to `undefined` under a lock with no
  open unlock session (`addNative`, `addCustomNative`, `addKitNative`, and both the insert and
  merge paths of `addLineItemSmartNative`) does the same for `taxRate`.

## Document rendering (`TotalsBlock`)

`src/lib/react-pdf/components/totals-block.tsx`'s new `TaxRows` component replaces the old single
`<tax_label> <tax_amount>` row with tri-state rendering:

| `tax_status` | Rendering |
|---|---|
| `EXEMPT` | `<tax_label> · Exempt`, plus `tax_exempt_reason` as a small muted line underneath when set |
| `UNSET` | `<tax_label> · Rate not set` — never a bare `$0.00`, which would read as a determination |
| `COMPUTED`, one rate | `<tax_label> · $X.XX` — byte-for-byte identical to pre-T3 output |
| `COMPUTED`, mixed rates | one row per distinct rate: `<tax_label> (N%) · $X.XX` |

`build-document-data.ts` computes `tax_status`/`tax_breakdown`/`tax_exempt_reason` for the LIVE
project path from the recalc-persisted fields. A specific DEPOSIT/BALANCE/CREDIT invoice's frozen
`invoiceContext.taxAmount` snapshot carries no per-rate breakdown (invoices weren't touched — out
of scope), so an invoice document always renders as a single `COMPUTED` row, identical to pre-T3
behaviour.

## UI

- **Client form** (`client-form.tsx`): a "Tax exempt" checkbox in the existing "More details"
  accordion, with a conditionally-shown reason field.
- **Line-item forms**: a new ungated "Advanced: tax rate" accordion (same progressive-disclosure
  pattern as the existing "Advanced: Xero coding" accordion), added to the five forms that
  genuinely operate on `projectLineItems` rows: `equipment-add-form.tsx`,
  `edit-line-item-dialog.tsx`, `custom-item-add-form.tsx`, `kit-add-form.tsx` (KIT_PRICE mode
  only — an ITEMIZED kit's parent line carries no price/revenue of its own, same scoping as
  discount), and `bulk-edit-line-items-dialog.tsx` (checkbox-gated, like every other bulk field).
  **`price-edit-dialog.tsx` and `edit-group-dialog.tsx` are deliberately excluded** — both edit
  Project GROUPS, and groups have no per-group rate override (design doc §3.4).

## Files touched

Schema: `convex/schema.ts` (`clients.taxExempt`/`taxExemptReason`, `projects.taxBreakdown`/
`taxStatus`, `projectLineItems.taxRate`). Guards: `convex/lib/moneyGuards.ts`,
`convex/lib/projectLocks.ts`, `convex/clientWrites.ts`. Recalc: `convex/lib/recalc.ts`,
`convex/recalc.test.ts`. Writes: `convex/lineItemWrites.ts`, `convex/projectWrites.ts`
(money-anchor stripping). Forms/validation: `src/lib/validations/client.ts`,
`src/lib/validations/line-item.ts`, `src/components/clients/client-form.tsx`,
`src/components/projects/{equipment-add-form,edit-line-item-dialog,custom-item-add-form,
kit-add-form,bulk-edit-line-items-dialog,line-item-form-fields}.tsx`,
`src/hooks/use-line-item-writes.ts`, `src/lib/line-item-edit-payload.ts`,
`src/lib/client-fields.ts`. Read/reconstruct mappers (both hand-maintained copies updated in
lockstep — see the codebase's existing duplicate-mapper pattern for `discount`/`discountMode`):
`src/lib/projects-read.ts`, `src/lib/project-detail-reconstruct.ts`,
`src/lib/project-equipment-reconstruct.ts`, `src/lib/project-line-item-read.ts`,
`src/components/projects/equipment-row-types.ts`. Documents: `src/lib/pdfme/types.ts`,
`src/lib/pdfme/build-document-data.ts`, `src/lib/react-pdf/components/totals-block.tsx`,
`src/lib/react-pdf/fixture.ts`.
