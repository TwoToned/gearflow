# 38. Pricing Optimization

## Overview

Automatic minimum-cost pricing for rental equipment. Given daily/weekly/monthly rates on a model and a billing period (months + weeks + days) on a project or group, the optimizer finds the cheapest combination.

## Architecture

```
Model (rates) + Project/Group (billing period)
  → optimizePrice() in src/lib/pricing.ts
  → unitPrice, pricingType=OPTIMIZED, duration=1, priceBreakdown
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/pricing.ts` | Pure optimizer function, `computeTotalDays`, `formatBreakdown` |
| `src/lib/pricing.test.ts` | 22 unit tests |
| `src/server/line-items.ts` | `addLineItem` auto-optimizes, `updateLineItem` detects overrides |
| `src/server/project-groups.ts` | `calculateSuggestedPrice`, `recalculateGroupPrices`, `getGroupBillingPeriod` |
| `src/server/models.ts` | `bulkUpdateRates` action |
| `src/components/assets/model-form.tsx` | Rate card (daily/weekly/monthly) with helper suggestions |
| `src/components/assets/model-table.tsx` | Completeness indicator, bulk rate update dialog |
| `src/components/projects/equipment-tab.tsx` | Breakdown display, manual badge, recalculate action |
| `src/lib/pdfme/plugins/gearflow-table.ts` | Breakdown text in PDF line items |

## Schema

- `Model.monthlyRate` — Decimal(10,2), nullable
- `Model.dailyRate`, `Model.weeklyRate` — already existed, now surfaced in UI
- `ProjectLineItem.priceBreakdown` — String, e.g. "2 weeks + 3 days"
- `ProjectLineItem.priceOverridden` — Boolean, default false
- `ProjectLineItem.overrideReason` — String, optional
- `Project.billingMonths` — Int, nullable
- `ProjectGroup.billingMonths` — Int, nullable
- `PricingType.OPTIMIZED` — new enum value

## Algorithm

Minimum-cost enumeration over all valid (months, weeks, days) splits:

1. Only use weekly rate if cheaper than 7 × daily
2. Only use monthly rate if cheaper than the equivalent weekly+daily coverage of one "month"
3. Enumerate all month/week combinations, compute remaining days
4. Pick the cheapest total

Constants: `DEFAULT_DAYS_PER_BILLING_MONTH = 28`, `DAYS_PER_BILLING_WEEK = 7`

### Configurable days-per-month (v0.8.2.0+)

Orgs can override the days-per-month value in Settings → Project Defaults
(range 20-31, default 28). Stored as `OrgSettings.daysPerMonth` on
`Organization.metadata`. `getOrgDaysPerMonth(organizationId)` reads it
defensively (`resolveDaysPerMonth` clamps and rounds; corrupt metadata
falls back to 28). Server actions thread the value through to
`optimizePrice` and `computeTotalDays` so the math agrees with the org's
billing convention.

## Pricing Flow

1. **Auto-optimize on add**: When `addLineItem` is called with a `modelId`, no explicit `unitPrice`, and billing period exists on group/project, the optimizer runs server-side. Sets `pricingType=OPTIMIZED`, `duration=1` (critical — grandTotal already includes full period).

2. **Override detection**: When `updateLineItem` changes `unitPrice` on an OPTIMIZED item, sets `priceOverridden=true` and clears `priceBreakdown`.

3. **Recalculate**: `recalculateGroupPrices(groupId)` re-runs optimizer on all non-overridden items. Kit-aware: skips children in KIT_PRICE mode, includes children in ITEMIZED mode.

4. **Billing period fallback**: Group billing → Project billing → null (skip optimization).

## UI

- **Model form**: "Rate Card" section with 3 rate inputs. Helper suggestions (4× daily for weekly, 12× daily for monthly) shown only when target field is empty.
- **Model table**: Teal dot (all 3 rates), amber dot (partial), no dot (none). Daily rate column. Bulk "Set Rates" action on selection.
- **Equipment tab**: "auto" label for OPTIMIZED items, "manual" badge for overridden items, breakdown text below price. "Recalculate Prices" in group dropdown.
- **PDFs**: Breakdown text rendered below unit price for OPTIMIZED items.

## Backward Compatibility

- `defaultRentalPrice` auto-synced from `dailyRate` on save (deprecated, kept for legacy compatibility)
- All new fields are nullable with defaults — zero-downtime migration
- Existing line items with `unitPrice` marked as `priceOverridden=true` via data migration
