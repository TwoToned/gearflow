<!-- STATUS: IMPLEMENTED 2026-09-15 — see FEATUREDOCS/75-tax-model.md for what T3 (#1091) shipped. -->
# RVLT Flow — Tax Model (exemptions, per-line rates, and scope)

**Created:** 2026-09-15
**Source:** T2 (#1090), part of the multi-tenant/internationalisation program (#1063/#1066).
**Design:** [`multi-tenant-and-international.md`](./multi-tenant-and-international.md) §3.4 —
this doc settles the decisions that section flagged as needing "a data-model decision, not a
formatting one."
**Depends on:** T1 (#1088, merged — the hardcoded 10% AU GST fallback in `recalc.ts` is fixed;
an org with no resolvable rate now produces zero tax).
**Implements into:** T3 (#1091).
**Related:** [FEATUREDOCS/66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md) (stored-bytes
rule), [FEATUREDOCS/67](../../FEATUREDOCS/67-sales-line-items.md), CLAUDE.md's "A client-facing
finance document is STORED BYTES" and "Discount: the AMOUNT is stored, the PERCENTAGE is
derived" sections.

## 0. Correction to the tracking issues — read this before implementing T3

Both #1090 and #1091, and §3.4 of the parent design doc, state that **`projectLineItems.taxRate`
already exists in the schema** and only needs to be "wired through recalc." This is **not
current**: `convex/schema.ts` has exactly one `taxRate` field in the entire schema, on the
**`projects`** table (the project-level override `recalc.ts` already reads at line ~241). Grep
and git history both confirm it: `taxRate` was added to `projects` once and has never existed on
`projectLineItems`.

```
$ grep -n "taxRate" convex/schema.ts
117:    defaultTaxRate: v.optional(v.number()),   # organization (Postgres-mirrored via orgSettings)
1281:    taxRate: v.optional(v.number()),          # projects — the only per-project override
2086:    defaultTaxRate: v.optional(v.number()),   # orgSettings mirror
2104:    defaultTaxRate: v.optional(v.number()),   # siteSettings (seed value only)
```

So T3's "per-line override" is **adding a new column**, not finishing an existing one. This
doesn't change the shape of the decision below, but it does mean T3's checklist item "wire it
through `recalc`" is preceded by "add `taxRate: v.optional(v.number())` to `projectLineItems` in
`convex/schema.ts`, plus the matching `by_cuid`-adjacent guard in `lineItemWrites.ts`." Everything
else this doc says about precedence and rendering holds regardless of which of the two issues was
right about where the column lives.

## 1. Current state (post-T1)

One `taxRate` resolution per project, computed once in `recalcProjectTotals`
(`convex/lib/recalc.ts:230-245`):

```
taxRate = project.taxRate ?? orgSettings.defaultTaxRate ?? 0
taxableAmount = subtotal - discountAmount     // discountAmount = subtotal × project.discountPercent / 100
taxAmount = round(taxableAmount × taxRate / 100)
```

`subtotal` is `equipmentRevenue + serviceRevenue + saleRevenue` — the sum of every non-cancelled
line's `lineTotal`, where each line's own dollar `discount` is already netted into `lineTotal`
(`calcLineTotalNative`: `max(0, unitPrice × quantity × duration − discount)`). The **project-level**
`discountPercent` is then applied a second time, as a flat percentage across the whole subtotal —
this is the number the totals block ("Discount (N%)") shows.

The document (`TotalsBlock`, `src/lib/react-pdf/components/totals-block.tsx`) renders exactly one
tax row: `<label = tax_label ?? "GST"> <amount = tax_amount>`. One rate, one row, always — this is
what breaks under §3.4's four market realities.

## 2. Per-client tax exemption

### 2.1 Schema

Add to `clients` (`convex/schema.ts`, beside `taxId`):

```ts
taxExempt: v.optional(v.boolean()),
taxExemptReason: v.optional(v.string()),   // free text, e.g. "Government purchase order #4471"
```

**No separate `taxExemptCertificateRef` field.** A certificate reference is exactly the same
shape as `taxExemptReason` (a short string an operator types once) — a second field would be a
second hand-maintained "why is this exempt" slot for the same fact (R-3.1). If certificate
*upload* (a scanned PDF) is ever wanted, that's a `Convex` file-storage attachment, not a text
field, and is out of scope here (no issue asks for it).

**No jurisdiction/scope/expiry fields.** A GitHub reviewer on #1090 (a tax-rates vendor, disclosed
conflict of interest, argument stands independently) correctly points out that a real US
exemption is jurisdiction- and reason-typed, not a boolean — but M2 explicitly excludes US
jurisdiction tables (§3), and a per-jurisdiction exemption record with nothing to key it against
(no jurisdiction table exists) is a field with no meaning. **When M2's scope is later revisited
for real US multi-state support, `taxExempt`/`taxExemptReason` gets superseded by a proper
per-jurisdiction exemption-certificate table — that migration is out of scope for T3 and is not
designed here.** Recording that now (rather than pretending a boolean will still be right) is the
whole point of writing it down.

### 2.2 Precedence: exemption is a hard short-circuit

`taxExempt: true` on the project's client makes the ENTIRE project's tax zero — not one line,
not "zero unless overridden by a line rate." A per-line or per-project rate is a statement about
*how much* to tax; exemption is a statement that *this client doesn't get taxed*. Layering them
(e.g., "line rate wins even for an exempt client") would silently produce a taxed invoice for a
client the org has already told the system is exempt — the worse failure mode of the two.

```
if (client?.taxExempt) taxAmount = 0        // short-circuits everything below in §3
else { ...§3's per-line/per-project resolution... }
```

`recalcProjectTotals` already has the project doc in hand and the project already carries
`clientId` — one additional `ctx.db.query("clients").withIndex("by_cuid", …)` lookup inside that
function is the only new read, not a new parameter threaded through every one of its ~10 call
sites (`lineItemWrites.ts`, `crewAssignmentsWrites.ts`, `categorySlotsWrites.ts`,
`projectServicesWrites.ts`, `projectGroupsWrites.ts`, …).

### 2.3 Document rendering — state the exemption, don't just omit the row

Per the issue's explicit requirement and the same reviewer's point: a reader cannot tell "no tax
applies" from "tax wasn't calculated" from a bare missing row or a `$0.00` line. `TotalsBlock`
gets a third rendering state alongside "one tax row" and "no tax row":

| State | Condition | Rendering |
|---|---|---|
| Taxed | resolved rate > 0 | `<tax_label> · $X.XX` (today's only state) |
| **Exempt** | `client.taxExempt` | `<tax_label> · Exempt` (+ `taxExemptReason` as a small muted line under it, when set) |
| **Unset** | no exemption, resolved rate is 0 because nothing was ever configured | `<tax_label> · Rate not set` — never a bare `$0.00`, which reads as a determination |
| Zero-rated | a line/project legitimately has a 0% rate on purpose (once mixed rates exist, §3) | `<tax_label> · $0.00` — this IS a determination, so the plain amount is correct here |

Distinguishing "unset" from "zero-rated" requires knowing WHY the resolved rate is 0 — `recalc`
already knows this at computation time (no project rate AND no org default AND no line rate AND
not exempt, vs. an explicit `0` typed somewhere), so it should persist which case applied
alongside `taxAmount`, not have the document layer try to reverse-engineer it. See §5 for the
field this adds.

## 3. Per-line tax rate override

### 3.1 Precedence

```
effectiveRate(line) = line.taxRate ?? project.taxRate ?? orgSettings.defaultTaxRate ?? 0
```

Most specific wins, same direction as every other cascade already in this codebase (Xero account
coding is the closest precedent — `xeroAccountCascade.ts`: line → model → kit → category →
org-default). A line with no override falls through to exactly what happens today.

### 3.2 Folding into `recalcProjectTotals` — group by effective rate, not one flat number

`subtotal`/`taxableAmount` today are single numbers with no per-line breakdown surviving into the
tax step. Mixed rates require knowing each line's *own* contribution to the taxable base:

1. For each non-cancelled, revenue-bearing line (the same set `equipmentRevenue`/`saleRevenue`
   already sum, plus `serviceRevenue`'s services — see §3.4 on why services don't get their own
   per-line rate field), compute its taxable base:
   ```
   lineTaxableBase = round(lineTotal × (1 − project.discountPercent / 100))
   ```
   This is exact, not an approximation: `discountPercent` is a flat percentage applied uniformly
   to the whole subtotal today, so distributing it per-line by the same percentage reproduces
   today's `taxableAmount` exactly when summed (`Σ lineTaxableBase == taxableAmount`, up to the
   existing per-line cent rounding this codebase already accepts everywhere else). A per-line
   *dollar* discount would NOT distribute this cleanly — but there is no such thing at the
   project level; `discountPercent` is the only project-level discount that exists.
2. Group lines by `effectiveRate(line)`.
3. Per group: `groupTax = round(Σ lineTaxableBase in group × rate / 100)`.
4. `taxAmount = Σ groupTax` (replaces today's single `taxableAmount × taxRate / 100`).
5. Persist the per-rate breakdown (not just the total) — the document needs it (§3.3), and
   recomputing it at render time from the line items would violate the stored-bytes rule (§4).

A project where every line resolves to the same rate (project rate, or nothing overridden) has
exactly one group — this reproduces today's single-line-item output byte-for-byte, so `recalc.test.ts`'s
existing assertions keep passing unmodified. That equivalence is the correctness gate for this
change: **before wiring anything, add a test asserting the new grouped computation equals the old
flat computation whenever no line has its own `taxRate` set.**

### 3.3 Document rendering — one row per non-zero rate present

The totals block currently renders one `<tax_label> <amount>` row. With mixed rates it renders one
row per DISTINCT rate actually present among the project's lines (Article 226 of the EU VAT
Directive requires exactly this breakdown on an invoice with mixed rates — cited in #1091 as "just
good sense on any multi-rate invoice" and it is; this isn't EU-specific behaviour, just the
correct one everywhere):

```
GST (10%)     $45.00
GST (0%)      $0.00        ← only shown if a line explicitly resolved to a 0% rate (§2.3 "zero-rated")
Total         $495.00
```

A project with only one resolved rate (the overwhelming common case, and 100% of rows before T3
ships) renders exactly as today — no `(N%)` suffix needed when there's only one, since the
existing single-line-item `<tax_label> <amount>` already says everything a reader needs. The
suffix only earns its place once there's a second row to disambiguate from.

### 3.4 Services and sale lines don't get their own per-line rate field

`projectServices` (labour/service lines) and standalone `SALE` lines feed `subtotal` the same way
equipment lines do, but neither issue asks for a `taxRate` column on them, and this doc doesn't
add one. They fall through the cascade at the "project rate" step, same as an equipment line with
no override — an explicit scoping line, not an oversight: extending the per-line override to two
more tables is real additional surface (a new `assertLineItemFields`-shaped guard, a new form
field, a new discovery-time question about whether the seven line-item forms differ from the
service-add flow), and no market reality in §3.4 of the parent doc requires it to ship this way.
If a real customer needs a mixed-rate line to be a SERVICE row rather than an equipment row, that
is new scope for a future issue, not silently swallowed here.

### 3.5 Blank means inherit, not an explicit 0% override

`src/lib/validations/line-item.ts`'s `taxRateField` originally shipped as a bare
`z.coerce.number().min(0).max(100).optional()`. `.optional()` only rescues a genuinely `undefined`
input — an untouched `<input type="number">` submits `""`, and `z.coerce.number()` turns that into
a real `0`, not "left blank". So an empty tax-rate box landed as an **explicit 0% override**
(`clear: []`, `taxRate: 0` written to the row) rather than clearing back to
`effectiveRate` inheriting the project/org rate (§3.1) — every line edited with the box emptied was
silently taxed at 0% instead of whatever it should have inherited.

This is the identical shape of defect #1249 fixed for `unitPrice`/`discount` (blank landing as a
real `$0` rather than "unpriced"), fixed the same way: `taxRateField` now uses the same
`blankableNumber` helper, so `""`/`null` map to `undefined` (→ `clear: ["taxRate"]` in
`buildLineItemSetClear`, `src/hooks/use-line-item-writes.ts`) before the 0-100 bound runs, while a
typed `0` still parses to `0` — a deliberate zero-rated line (§2.3) stays distinguishable from a
cleared override. It was deliberately split out of #1249 rather than riding along, because unlike
price/discount this changes what a client is actually invoiced on every line touched with an empty
box, and deserved its own review.

**No backfill.** Same reasoning as §4 below: a stored `taxRate: 0` on an existing row is
indistinguishable, after the fact, from a deliberate zero-rated line (§2.3) — there is no way to
tell "this was left blank under the old bug" apart from "this was intentionally zero-rated" without
guessing, and guessing wrong would silently change what a project is taxed. Any pre-fix row keeps
whatever `taxRate` it already has; the fix only changes how a box left blank behaves **from now
on**. An operator who suspects a specific line was mistakenly zeroed can re-open it and clear the
box by hand — the same manual correction §4 already expects for a rendered document that predates a
behaviour change.

## 4. The stored-bytes rule closes the historical-migration problem

CLAUDE.md's finance-document rule — a sent quote / issued invoice PDF is rendered once and its
bytes attached to the row, never regenerated — combined with M6 (country immutable once an org
sets it) means **there is no historical-migration problem for this design to solve.** An invoice
issued last month under the old single-rate computation keeps exactly the bytes it was issued
with; T3 shipping doesn't retroactively change what any existing document says, and no backfill
of `taxExempt`/`taxRate` onto old rows is needed or wanted. This is worth stating explicitly, per
the issue, so nobody builds a migration for a problem that doesn't exist. The only thing that
changes is what a NEWLY rendered document computes from NOW on.

## 5. What gets persisted on `projects` (recalc outputs)

`recalcProjectTotals` already patches `taxAmount`/`total` onto the project row (`projects` table).
Two additions:

- `taxBreakdown: v.optional(v.string())` — JSON array of `{ rate: number; amount: number }`,
  one entry per non-zero-taxable-base group from §3.2, in descending-rate order. A `[]` (not
  absent) means "computed, no lines" (an empty project); absent means "never recalculated"
  (pre-T3 rows, and the one tick immediately after migration before their next write). Stored as
  a JSON string, same convention `orgSettings.settings` already uses for a small structured blob
  that doesn't need its own indexed columns.
- `taxStatus: v.optional(v.union(v.literal("EXEMPT"), v.literal("UNSET"), v.literal("COMPUTED")))`
  — the §2.3 disambiguator. `EXEMPT` when the client's flag applied; `UNSET` when the resolved
  rate was 0 purely because nothing was ever configured anywhere in the cascade; `COMPUTED`
  otherwise (including a deliberate 0% line — see §3.3, that case still has real breakdown rows,
  just at 0%, which is what distinguishes it from `UNSET`'s empty breakdown).

Both are recalc OUTPUTS (like `taxAmount` itself), not client-settable — they get the same
`PROJECT_MONEY_ANCHORS`-style stripping treatment `projectWrites.ts` already applies to every
other derived money field, not a new exemption to that rule.

## 6. Guardrails (R-9.3, server is the authority)

- **`projectLineItems.taxRate` bounds**: 0–100, same range `assertProjectMoneyFields` already
  enforces for `project.taxRate` (`convex/lib/moneyGuards.ts`) — add the check to
  `assertLineItemFields` (`lineItemWrites.ts:256`) rather than inventing a second bounds constant,
  mirroring `src/lib/validations/project.ts`'s existing `taxRate` Zod bound on the client-schema
  side (R-3.1: one definition of "valid tax rate" for project and line alike).
- **`clients.taxExempt`/`taxExemptReason`**: `taxExempt` is a plain boolean (nothing to bound);
  `taxExemptReason` gets the same `assertStrLen(…, { max: 500 })` treatment every other free-text
  client field already gets in `clientWrites.ts` — no new pattern, just applying the existing one
  to a new field.
- **Both are validated in the mutation, never trusted from a client Zod pass alone** — a
  browser-direct caller hitting the Convex mutation with `taxRate: -50` or a 10,000-character
  `taxExemptReason` must be rejected in-transaction, exactly the reasoning `moneyGuards.ts`'s own
  module comment already gives for why `assertProjectMoneyFields` exists.

## 7. Explicitly out of scope (and why, for the record)

- **US jurisdiction tables.** Not "45 states" — closer to 13,000 overlapping taxing jurisdictions
  (state/county/city/special-district), boundaries that don't follow ZIP or city lines, and
  continuous (not quarterly) rate changes. A ZIP-keyed table is wrong at the resolution below the
  one it would be built at; published replay data on a comparable problem (an unrelated Odoo
  US-localisation effort, `OCA/l10n-usa#198`) found ZIP-level rates agreeing with correct combined
  rates only ~64% of the time across real transactions, with street-level resolution needed to
  close the gap. This is a permanent maintenance liability, not a feature, and correctly deferred
  to an external provider (Avalara/TaxJar/Stripe Tax, or a rates-only API like Ziptax) until a
  real multi-state customer exists to justify the integration cost.
- **Equipment-rental taxability itself varies by state** — some states tax the periodic rental
  payment stream rather than item value, some source differently for a lease vs. a sale, and
  whether rental is taxable at all differs. This means the eventual answer (whenever M2's US scope
  is revisited) is a function of the line, the transaction type, AND the destination — never a
  property of the org or the line alone. Recorded here as a known constraint on that future work,
  not solved now.
- **Reverse charge, OSS (One-Stop-Shop), VIES VAT-number validation** — all EU cross-border
  mechanisms, explicitly M3-and-later (M3 is single-country EU only per the parent design doc).
- **A per-jurisdiction exemption-certificate table** (reason/jurisdiction/scope/expiry) — see §2.1;
  the boolean-plus-reason shape here is intentionally the M2-appropriate answer, not a placeholder
  for the real US answer.

## 8. Summary — what T3 builds

| # | Change | Where |
|---|---|---|
| 1 | `taxExempt` + `taxExemptReason` on `clients` | `convex/schema.ts`, `clientWrites.ts`, `client-form.tsx`, `validations/client.ts` |
| 2 | `taxRate` on `projectLineItems` (new column — see §0) | `convex/schema.ts`, `lineItemWrites.ts` |
| 3 | Exemption short-circuit + per-line rate grouping in `recalcProjectTotals` | `convex/lib/recalc.ts` |
| 4 | `taxBreakdown` + `taxStatus` recalc outputs on `projects` | `convex/schema.ts`, `recalc.ts`, `projectWrites.ts` (money-anchor stripping) |
| 5 | Bounds guard for the new line field, string-length guard for the new client fields | `convex/lib/moneyGuards.ts` or `lineItemWrites.ts`'s `assertLineItemFields`, `clientWrites.ts` |
| 6 | Multi-row / exempt / unset rendering in `TotalsBlock` | `src/lib/react-pdf/components/totals-block.tsx`, `build-document-data.ts` |
| 7 | Per-line rate field in the line-item forms, behind progressive disclosure | the seven add/edit line-item forms, same "More details" accordion pattern the discount-mode UI already uses |
| 8 | Equivalence regression test (grouped calc == old flat calc when nothing overridden) | `convex/recalc.test.ts` |
