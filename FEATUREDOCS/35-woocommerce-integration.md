# WooCommerce Integration

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

Automatically creates RVLT Flow projects from WooCommerce orders via webhook.

## Architecture

### Database Models

| Model | Purpose |
|-------|---------|
| `WooCommerceIntegration` | Per-org config (one row per org). Stores webhook secret, matching strategy, field mapping, defaults |
| `WooCommerceOrderLog` | Audit log of every webhook delivery. Status: `PROCESSING`, `COMPLETED`, `FAILED`, `DUPLICATE` |

**Schema additions:**
- `Model.sku` — Optional SKU field for WooCommerce product matching
- `WooCommerceIntegration.locationMetaKey` / `defaultLocationId` — Location mapping config

### Webhook Flow

```
WooCommerce (order.created) → POST /api/integrations/woocommerce/webhook
  1. Ping detection (accept without HMAC for webhook creation)
  2. Parse JSON body (cheap `id` presence check only — shape not yet trusted)
  3. Resolve organization (single-org auto-detect or ?org= param)
  4. Load integration config, verify enabled
  5. HMAC-SHA256 signature verification (timing-safe)
  6. Validate payload shape against `wooOrderSchema` (Zod, R-8.2.3) — 422 on failure
  7. Idempotency check (skip if same order already COMPLETED)
  8. Store lastPayload (for Test & Detect UI)
  9. Respond 200 immediately
  10. Background: processWooCommerceOrder()
```

Signature verification proves the sender holds the shared secret; it says nothing
about the JSON *shape*. The raw parsed body is only trusted for `.id` (the
cheap ping check) until it passes `wooOrderSchema.safeParse` — which runs after
HMAC verification, so an unauthenticated caller can't probe the schema. Unknown
WooCommerce order fields are silently dropped (default non-strict `z.object`
behavior); only the fields this integration actually reads are modeled.

### Order Processing (`processWooCommerceOrder`)

1. **Find or create client** — Email match (exact), fuzzy company match (Dice coefficient >= 0.7), or auto-create
   - If order has company name and email matches an INDIVIDUAL client, skips to company matching
   - Company matching normalizes names (strips Pty Ltd, Inc, LLC, etc.) before comparing
2. **Extract dates** — Maps order meta keys to rental start/end and event date
3. **Match products** — Three strategies:
   - `sku` — WooCommerce SKU → Model.sku, falls back to Model.modelNumber
   - `custom_field` — Meta field value → Model.id
   - `name` — Product name → Model.name (case-insensitive contains)
4. **Resolve location** — Meta key → fuzzy match existing locations (name + address, substring, bigram), auto-creates VENUE if no match
5. **Create project** — With client, dates, location, line items (EQUIPMENT for matched, MISC for unmatched). Also
   seeds `discountPercent` from the matched/created client's `Client.defaultDiscount` when set (QW-4 / #953) — this
   path builds the project directly (`api.projects.createWithUniqueNumber` / `wooCommerceInternal.
   createProjectWithUniqueNumber`, both plain inserts) rather than through `projectWrites.createNative`, so it
   doesn't get that mutation's in-mutation discount cascade for free; `resolveWooDiscountPercent`
   (`src/lib/woocommerce-utils.ts`, verbatim-copied into `convex/wooCommerceActions.ts` — Convex can't import from
   `src/`) is the shared one-liner both copies call. A snapshot, not a live link — see the Project Wizard section
   in FEATUREDOCS/10 for the same semantics on the manual-create path.
6. **Recalculate totals**, log activity, notify configured users

### Client Matching Strategy

```
Email exact match → use (unless INDIVIDUAL + order has company)
  ↓ no match
Company fuzzy match (Dice coefficient ≥ 0.7)
  ↓ no match
Auto-create client (COMPANY if company name, INDIVIDUAL otherwise)
```

Company name normalization strips: Pty Ltd, Inc, LLC, Corp, GmbH, Holdings, etc.

### Location Resolution

```
Location meta key configured?
  ↓ yes, meta value present
  Exact name match (case-insensitive)
  → Address match (case-insensitive)
  → Substring match (name or address, either direction)
  → Bigram fuzzy match (Dice coefficient ≥ 0.6)
  → Auto-create new VENUE location
  ↓ no meta key or empty value
  Default location ID (if configured)
  → null
```

## Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | `wooCommerceIntegrations`, `wooCommerceOrderLogs` tables, `Model.sku` field (moved here from Prisma in the Convex-native domain migration; only a vestigial `WooOrderLogStatus` enum remains in `prisma/schema.prisma`) |
| `convex/wooCommerceIntegrations.ts`, `convex/wooCommerceOrderLogs.ts`, `convex/wooCommerceActions.ts`, `convex/wooCommerceInternal.ts` | Convex queries/mutations/actions backing the integration + order log |
| `src/server/woocommerce.ts` | Server actions (still `"use server"`, reading/writing via the Convex client above) + `processWooCommerceOrder` background processor |
| `src/lib/woocommerce-utils.ts` | `verifyWebhookSignature` (HMAC-SHA256), `flexibleDateParse` (multi-format), `resolveWooDiscountPercent` (QW-4 discount seed) |
| `src/lib/validations/woocommerce.ts` | Zod schema for settings form (`wooCommerceIntegrationSchema`) + the webhook trust-boundary schema (`wooOrderSchema`) that `WooOrder` is `z.infer`'d from |
| `src/app/api/integrations/woocommerce/webhook/route.ts` | POST webhook endpoint (public, in middleware allowlist) |
| `src/app/(app)/settings/woocommerce/page.tsx` | Settings UI (enable/disable, connection, matching, dates, location, defaults, setup guide, order log) |

## Settings Page Sections

1. **Enable/Disable** — Master toggle
2. **Connection** — Store URL, webhook URL (copy), webhook secret (show/copy/regenerate)
3. **Product Matching** — Strategy select (SKU / custom field / name), custom field key input
4. **Date Field Mapping** — Meta keys for rental start/end, event date, delivery address, notes. Date format select. Test & Detect panel (reads `lastPayload` to show available meta keys)
5. **Location Mapping** — Location meta key input, default location dropdown (fetches from `getLocations`)
6. **Project Defaults** — Default project type, auto-advance to Quoting toggle
7. **WordPress Setup Guide** — Collapsible instructions for WooCommerce webhook setup
8. **Recent Orders** — Order log table with status badges, match summaries, retry button for failed orders

## Key Gotchas

- `verifyWebhookSignature` and `flexibleDateParse` are in `src/lib/woocommerce-utils.ts` (NOT in the server action file) because `"use server"` requires all exports to be async
- WooCommerce ping requests are accepted without HMAC verification (topic: `action.woocommerce_webhook_delivery` or missing `id`)
- The webhook secret in RVLT Flow must be copied to WooCommerce's webhook Secret field — they must match
- `WooOrder` is `z.infer<typeof wooOrderSchema>` (`src/lib/validations/woocommerce.ts`), not a hand-written interface — the webhook route parses into it via `wooOrderSchema.safeParse` before any field is read (R-8.2.3). Re-reading an already-processed order from storage (`retryFailedOrder`, `getLastPayloadMetaKeys`) still casts (`as unknown as WooOrder`) since that payload was already validated on the way in and isn't a new trust boundary.
- `PricingType` enum uses `PER_DAY` not `DAILY`
- Select components need explicit `defaultValues` in `useForm` to avoid controlled/uncontrolled warnings

## Migrations

| Migration | Purpose |
|-----------|---------|
| `20260318000000_add_sku_to_model` | Add `sku` column to `model` table + unique index |
| `20260318000001_add_woocommerce_integration` | Create `woocommerce_integration` and `woocommerce_order_log` tables, `WooOrderLogStatus` enum |
| `20260318000002_add_woocommerce_location_mapping` | Add `locationMetaKey` and `defaultLocationId` to `woocommerce_integration` |
