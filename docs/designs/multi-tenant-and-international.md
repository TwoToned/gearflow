# Multi-tenant & international — platform readiness sweep

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-08-01
**Status:** Sweep — findings only, nothing built.
**Parent of:** [`onboarding-and-activation.md`](./onboarding-and-activation.md). That doc began as
an onboarding feature and grew a multi-tenancy prerequisite underneath it. This doc is the
platform half: everything that must be true for RVLT Flow to host **many organisations in
many countries**. Onboarding is the surface those changes eventually show up on.
**Binding constraints:** [`POLICY.md`](../../POLICY.md) (profile `WEB`), [`DESIGN.md`](../../DESIGN.md).

---

## 1. The shape of it

Two programs that look separate and aren't:

- **Multi-tenant** — many orgs on one deployment. Mostly done in the data layer; the
  remaining work is identity resolution plus finishing an audit that was already started.
- **International** — many countries in those orgs. Barely started. Currency, dates, paper
  size and tax are all hardcoded to Australia.

They compound: with one org, "Australia" is a safe global constant. With many orgs, every
one of those constants is a bug waiting for the first overseas customer.

The good news, twice over: the formatting gaps nearly all funnel through **one module**, and
the cross-tenant audit **already has a working harness**.

---

## 2. Multi-tenant — corrected picture

### 2.1 Correction to the onboarding doc

`onboarding-and-activation.md` §2.3 states the org guards are "unfalsifiable" and that the
adversarial harness needs building. **Both are too pessimistic**, and the correction changes
the plan:

**`convex/xtenantHardening.test.ts` already exists** — 198 lines, and it is exactly the
two-org adversarial fixture that doc proposed. It seeds `org_A` / `org_B`, plants rows in
both sharing a colliding FK cuid, and asserts org A's caller never sees org B's row:

```
await ctx.db.insert("assets", { id: "aA", organizationId: A, assetTag: "A1", modelId: "m1" });
await ctx.db.insert("assets", { id: "aB", organizationId: B, assetTag: "B1", modelId: "m1" });
const rows = await t.withIdentity(asA).query(api.assets.listByModel, { orgId: A, modelId: "m1" });
expect(rows.map((r) => r.id)).toEqual(["aA"]);          // org B's row NOT leaked
```

It covers session identity, **agent-token identity**, an "organizationId in the request
naming the other org doesn't widen it" case, the #1001 previously-unguarded reads, and
create-time cuid dup-guards. There were deliberate hardening passes here already — the file
names Phase 3, #998 and #1001.

So the guards are **falsifiable in `convexTest`** (which can hold two orgs even though
production holds one), and some are already tested. The accurate statement is narrower:

> They are unfalsifiable **in production**, and only representatively tested. The file says
> so itself: _"Representative coverage of each class (the fix is identical across all sites)."_

### 2.2 What that leaves

Eight tests against a surface of **72 `listBy*` queries** and ~1,500 `by_cuid` reads. The
work is **representative → exhaustive**, driven by `src/lib/api/registry.generated.ts`, which
already enumerates every agent-reachable operation. Same amount of work as before, far less
risk: the pattern is proven, the fixture shape exists, and the assertion style is settled.

This should be a ratchet, like the reachability floor in `docs/api-coverage.md` — coverage
can only go up, and a new operation joins the sweep automatically.

### 2.3 Remaining multi-tenant gaps not in the onboarding doc

| Gap | Evidence | Note |
|---|---|---|
| **Maintenance cron runs unscoped by org** | `convex/maintenanceScheduleGeneration.ts:99` — its own comment: _"with no per-cron orgId to scope by — collectCapped bounds"_ | Correct today (one org). With many, one org's volume can starve another's cycle generation. Needs per-org iteration with a fairness bound. |
| **No per-org storage or usage quota** | none found | Archived orgs retain Convex `_storage` (onboarding doc §5.4). Unbounded per tenant. |
| **Rate limiting scope unverified** | `convex/lib/rateLimiter.ts` `enforceBrowserWriteLimit` | Confirm the key is `(org, user)`, not global — a global bucket lets one tenant throttle everyone. **Verify during Phase A.** |
| **Site defaults are platform-global** | `SiteSettings.defaultCurrency`, `defaultTaxRate` | Sensible as *seed values* for a new org, wrong as an operating default once orgs differ. Make the seeding explicit. |

### 2.4 Already multi-tenant-shaped — no work needed

Worth recording so nobody re-solves them: email templates already take `orgName` **and**
`platformName` separately (`email-templates.ts:34-52`); iCal tokens are per-org in
`OrgSettings`; SSO is slug-based; API keys, project-number sequences, asset-tag counters and
invoice sequences are all per-org already.

---

## 3. International — the real gap

Nothing here is hard individually. The problem is that "Australia" is currently a constant in
four unrelated layers.

### 3.1 The single biggest lever: `src/lib/formatters.ts`

Nine lines, two functions, and **241 call sites across 39 files**:

```ts
export function formatCurrency(value) {
  return `$${Number(value).toLocaleString("en-AU", { … })}`;   // ← hardcoded symbol + locale
}
export function formatDate(date) {
  return d.toLocaleDateString("en-AU", { … });                  // ← hardcoded locale
}
```

`OrgSettings.currency` **exists and is never read by the formatter.** An org set to GBP still
renders `$1,234.56`, AU-grouped.

Fix this one module and most of the display layer becomes international at once. The catch is
that these are pure sync functions, so each call site needs the org's locale in scope:

- **Client** — a `FormatProvider` in the app layout (org settings are already loaded there)
  exposing `useFormatters()`. Keep the bare functions as the un-themed fallback.
- **Server / PDF** — already have `orgSettings` in hand; `build-document-data.ts:730` reads
  `orgSettings.taxLabel` today, so the same object supplies currency and locale.

Do **not** add a second currency-formatting helper anywhere (R-3.1).

### 3.2 Dates are inconsistent *already*

Beyond the hardcoded `en-AU`, format strings are scattered and **contradictory** — both
`"d MMM yyyy"` (day-first) and `"MMM d, yyyy"` (month-first) appear in the codebase today.
That is an existing bug at any single locale, and it gets worse per country. Route them
through the same provider.

### 3.3 PDF paper size is A4, baked into the geometry

`src/lib/pdfme/template-constants.ts` hardcodes **210 × 297 mm** — A4. The US and Canada use
Letter (216 × 279 mm). This is not a display setting: the constants feed `CONTENT_WIDTH`,
`PAGE_CONTENT_HEIGHT` and every pagination calculation in `document-composer.ts`, which is
the engine that decides where pages break.

**Treat this as the hardest international item.** Per CLAUDE.md's PDF rule, a change to
pagination geometry needs an integration test per doc type against a realistic fixture, not
just plugin-level unit tests — `document-composer.test.ts` is the standing harness and would
need a Letter variant of each fixture.

> Minor, spotted in passing: those constants are named **`nIDTH` / `nEIGHT`** — the residue
> of a find-and-replace that ate the `W` and `H`. Harmless, confusing, worth fixing while
> the file is open.

### 3.4 The tax model is single-rate and org-level

One `taxRate` + one `taxLabel` per org, flowing to the project (`convex/invoicesWrites.ts:320`
`orgDefaultTaxRate`). That is genuinely correct for **AU/NZ GST** and **UK single-rate VAT**,
and it is why this has never bitten.

It does not survive contact with:

| Market reality | Why it breaks |
|---|---|
| **US sales tax** | Per state *and* county, destination-based, and equipment rental is taxed inconsistently (some states exempt, some tax rental-as-sale). No single org rate can be right. |
| **Tax-exempt clients** | Government, education, resale. Needs a per-client exemption flag, which doesn't exist. |
| **EU cross-border** | Reverse charge — B2B cross-border is zero-rated with a legend on the invoice. |
| **Mixed-rate lines** | Reduced/zero rates on some items. A per-line `taxRate` column exists in the schema but nothing drives it. |

**This is a data-model decision, not a formatting one**, and it is the one item here that
should get its own design doc rather than being folded into a sweep. A reasonable staged
answer: keep the single-rate model, add a **per-client tax-exempt flag** and a **per-line
rate override**, and explicitly declare US sales tax out of scope until there's a customer —
correct multi-jurisdiction sales tax generally means an external service (Avalara/TaxJar),
not in-house tables.

### 3.5 "ABN" and "GST" are hardcoded in documents

The same country-derived-label point as the onboarding wizard (`onboarding-and-activation.md`
§6.1), but on the output side:

- `document-composer.ts:871` — `ABN: ${data.org_abn}`
- `document-composer.ts:924` — `ABN: ${data.client_tax_id}` (the *client's* number)
- `build-document-data.ts:730,772` — `taxLabel || "GST"`

The `"GST"` fallback is fine as an Australian default and wrong as a global one. All three
should read the country table that the wizard uses, so the label is defined once.

Also country-specific: **"Tax Invoice"** is an Australian legal term. Other jurisdictions
have their own required document headings and mandatory fields.

### 3.6 Smaller items

| Item | Evidence | Fix |
|---|---|---|
| **Week starts Monday, hardcoded** | `availability/page.tsx:211` `weekStartsOn: 1` | US/Canada start Sunday. Locale-driven. |
| **…and a duplicate `startOfWeek`** | `crew/planner/page.tsx:51` hand-rolls it, ignoring `date-fns` | DRY violation (R-3.1) *and* a second place to fix. Collapse into one. |
| **Weights are kg only** | `model-form.tsx`, `kit-form.tsx`, `document-composer.ts` | Imperial needed for the US. |
| **Places autocomplete unrestricted** | no `componentRestrictions` found | Bias suggestions to the org's country. |
| **Number grouping** | via `toLocaleString` | Comes free once the locale is threaded (§3.1). |

### 3.7 No i18n framework — and that may be correct

There is **no** `next-intl` / `i18next` / `formatjs`; every string is hardcoded English.

That is a defensible position for AU / NZ / UK / US / CA, which is plausibly the whole
addressable market for an English-language AV rental product. **But it should be an explicit
decision, not an accident** — retrofitting translation across a UI this size is expensive, and
the cost only grows. Recommend: record it as a deliberate scope boundary now, and revisit
only on a real non-English customer.

Note the distinction — **localisation of formats (§3.1–3.6) is needed regardless.** A US
customer reading English still needs `$` to mean USD, dates month-first, and Letter paper.

---

## 4. Sequencing

| # | Work | Effort | Depends on |
|---|---|---|---|
| 1 | Identity chokepoints + org switcher + archiving (onboarding doc §4) | L | — |
| 2 | **Extend `xtenantHardening.test.ts` to registry-driven exhaustive**, ratcheted | M | 1 |
| 3 | Per-org cron fairness, rate-limit scope check, quota visibility (§2.3) | S | 1 |
| 4 | **Locale + currency through `formatters.ts`** (§3.1–3.2) | M | — |
| 5 | Country table drives labels: business number, tax label, doc headings (§3.5) | S | 4 |
| 6 | Paper size (§3.3) | M | 4 |
| 7 | Week start, units, address bias (§3.6) | S | 4 |
| 8 | Tax model — **own design doc** (§3.4) | L | — |

Items 4–7 are **independent of multi-tenancy** and could ship first. There is an argument for
doing exactly that: they are lower-risk, user-visible, and they make the multi-tenant launch
able to accept a non-Australian customer on day one instead of shipping a known trap.

---

## 5. What this changes in the onboarding doc

- §2.3 and §4.5 are **corrected** by §2.1 above — the harness exists; the work is extending
  it, not building it. Phase A's risk drops; its effort does not.
- The wizard's country step (§6.1) is the **input** side of the same country table that §3.5
  needs on the **output** side. One table, defined once, or it will be two.
- "Which countries do we actually support?" becomes a real product question the wizard's
  country dropdown has to answer honestly. Offering 195 countries while formatting, paper
  size and tax only work for four is worse than offering four.

---

## 6. Open questions

1. **Which countries at launch?** AU + NZ + UK is nearly free (single-rate VAT/GST, A4,
   day-first dates). Adding the **US** pulls in Letter paper, month-first dates, Sunday weeks,
   imperial units and the whole sales-tax problem — it is by far the most expensive single
   country, and it should be a deliberate yes, not a side effect of a dropdown.
2. **Tax: staged or solved?** Per-client exemption + per-line override covers most of the
   non-US world cheaply. Full US sales tax realistically means an external provider.
3. **Is English-only a recorded decision?** (§3.7)
4. **Does an org's country ever change?** Historical documents must keep the tax label, paper
   size and currency they were issued under — the finance-document rule already says a
   rendered document is stored bytes, which protects this, but a live re-render of an old
   project would not be protected.
