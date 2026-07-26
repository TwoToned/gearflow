# Client Contacts (WS9 #948)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

## Summary

A client can now carry **multiple contacts**, fully optional — a client with zero
contacts stays valid. This is the **expand + migrate** half of an
expand-migrate-narrow rollout; **narrowing** (dropping the 3 legacy embedded fields
from the schema, Zod, and the 4 hand-written arg lists) is a **separate follow-up**,
not done here.

## Data model

- **`clientContacts`** (`convex/schema.ts`) — DIRECT table (carries
  `organizationId`). Fields: `id`, `organizationId`, `clientId`, `name?`, `role?`
  (free text — an enum can follow if a future workstream wants role-routed
  documents), `email?`, `phone?`, `notes?`, `isPrimary?`, `sortOrder?`,
  `createdAt?`, `updatedAt?`. Indexes: `by_cuid`, `by_organizationId`,
  `by_clientId`.
- **Usefulness floor**: a contact must carry at least one of {name, email, phone}
  — enforced by both `clientContactSchema` (`src/lib/validations/client-contact.ts`)
  and `clientContactWrites.ts`'s `assertContactHasSubstance` (R-8.6.2 — a
  browser-direct caller bypassing the client Zod parse still hits the same bound).
- **Duplicate email on one client is ALLOWED** (spec decision) — the contacts
  manager UI warns inline but never hard-blocks.
- **`isPrimary` semantics** mirror `mediaWrites.ts`'s `setPrimaryNative`:
  exclusive-per-client, absent = false, the client's FIRST contact is always
  primary, and removing the primary promotes the next-lowest-`sortOrder` contact
  (a client is never left with contacts but no primary).
- **Cap**: 50 contacts per client (bounds `clients.detail`'s per-client collect).
- **Hard delete** — contacts aren't referenced by historical snapshots (invoices
  snapshot contact TEXT at document-build time, not an FK), so removing a contact
  is a plain delete, no soft-archive.
- The legacy embedded `clients.contactName/contactEmail/contactPhone` fields
  **stay live as read-only legacy** during the migration window — no new write
  path populates them (`toClientFields` in `src/lib/client-fields.ts` no longer
  maps them). Every consumer reads a client's contact info through
  **`getPrimaryContact` / `resolveClientContactDisplay`**
  (`convex/lib/clientContactCore.ts`, re-exported for Next.js code via
  `src/lib/client-contact-helpers.ts` — the same isomorphic-core pattern as
  `convex/lib/permissionsCore.ts` / `src/lib/permissions.ts`), which falls back to
  the legacy fields only when a client has no contact rows yet.

## Writes

`convex/clientContactWrites.ts` — `addNative` / `updateNative` / `removeNative` /
`setPrimaryNative` / `reorderNative`. Gated on **`client:update`** (no new RBAC
resource — a contact is a sub-resource of the client it belongs to). Standard 4
guards (`assertWritesEnabled` → `enforceBrowserWriteLimit` →
`requireOrgPermission` → `resolveActor`) + per-row org (+ client) re-check + one
atomic `writeActivityLog` per write, filed under **`entityType: "client"` /
`entityId: <clientId>`** so it folds into the existing client `ActivityTimeline`
unchanged (spec decision — no separate contacts timeline).

`convex/clientContacts.ts` is the thin service-gated CRUD (mirror-layer
convention); `forClient` and `listByOrg` are the two browser/server-readable
queries (`requireOrgRead`), used by the project wizard picker and WooCommerce
matching respectively.

## Migration (widen → migrate → defer-narrow)

1. **Widen**: `clientContacts` ships; the 3 embedded fields on `clients` stay.
2. **Backfill** (`convex/backfillClientContacts.ts`, service-gated, paginated,
   idempotent — skips any client that already has a contact row): a client whose
   embedded contact carries any field gets ONE `ClientContact{isPrimary:true}`
   row. `name` is synthesized from the email's local-part ONLY when
   `contactName` was absent but `contactEmail` was present; an entirely-empty
   embedded contact gets no row. Driver: `scripts/convex-backfill-client-contacts.ts`
   (`--apply` to write, dry-run by default).
3. The child table is authoritative from day one — **no dual-write**. New client
   creation (`ClientForm`, `QuickCreateClient`) writes the primary contact as a
   **second call** right after the client itself commits (two-phase — the
   client's cuid is already minted client-side, see `useClientWrites().create()`
   in `src/hooks/use-native-client-writes.ts`).
4. **Narrow** (drop the 3 legacy fields from the schema, `clientSchema`,
   `clientFields`, `toClientFields`, and the 3 hand-written arg lists in
   `convex/clients.ts`) is a **separate follow-up PR** — not done here.

## Per-project contact

`projects.clientContactId?` — the project's picked contact, defaulting to "use
the client's primary" when unset (never auto-filled; the PDF/token resolution
chain below handles the fallback). Validated in `projectWrites.ts`
(`createNative` + the general `updateNative` set/clear path) against
**both** org AND the project's (possibly newly-set) client via
`assertClientContactBelongsToClient` (`convex/lib/orgRef.ts`) — a contact from a
DIFFERENT client can never be pinned to a project. **Cleared automatically** when
the project's `clientId` changes (or is cleared) without an explicit new contact,
both server-side (the authoritative guard) and client-side (the wizard resets the
field on client-change for UX, `project-wizard.tsx`).

UI: the project wizard's "Basics" step shows a contact picker (below the client
picker) once a client is selected, sourced from `useClientContacts` /
`api.clientContacts.forClient`, each option flagged "Primary" where applicable. A
dedicated non-wizard project-sidebar quick-editor was intentionally **not**
added — the existing `clientId` field has no such quick-editor either (project
edits route through the wizard), so the contact picker matches that established
UX rather than introducing a new pattern for just this one field.

## PDF resolution chain

`build-document-data.ts`'s `client_contact` / `client_email` / `client_phone`
tokens resolve, in order: **the project's explicitly selected contact** → **the
client's primary contact** → **the legacy embedded fields** (migration-window
fallback), via `resolveClientContactDisplay`. The "Attn:" line itself is rendered
by `document-composer.ts`'s `detailsRow` block, unchanged — only the upstream
token value changed. (The original spec referenced a `shared-builders.ts:47` for
this — no such file exists in this repo; the actual site is
`document-composer.ts`.)

## WooCommerce (both copies — `convex/wooCommerceActions.ts` +
`src/server/woocommerce.ts`)

- **Email match widened**: step 1 of `findOrCreateClient` now matches an
  incoming order's billing email against **any** of an active client's contacts
  (not just the legacy embedded `contactEmail`) — `clientKnowsEmail` /
  `groupContactsByClient`. The Convex-native copy keeps its own inline verbatim
  version (Convex function files cannot import `src/lib/*` — see
  `convex/lib/permissionsCore.ts`'s header); the Next.js server-action copy
  extracted the pure decision helpers to `src/lib/woocommerce-client-match.ts`
  so they're unit-testable without exporting anything new from the `"use
  server"` `woocommerce.ts` file (exporting `findOrCreateClient` itself would
  have made an un-permission-checked, raw-`orgId`-taking helper directly
  client-invocable as a server action — a cross-tenant IDOR — so it stays
  un-exported; only the pure helpers are shared/tested).
- **Auto-create on fuzzy match**: when step 2's fuzzy company match succeeds and
  the order's billing email is unknown to the matched client (neither the
  legacy field nor any contact row), an **additional, non-primary** contact is
  created, tagged `"Auto-created from a WooCommerce order"` — instead of
  silently losing the order's contact info.
- Behaviour-pinned tests: `convex/wooCommerceActions.test.ts` (via a test-only
  exported action wrapper, `_findOrCreateClientForTest` — `findOrCreateClient`
  itself needs a real ActionCtx, which only `convexTest`'s `t.action(...)`
  provides) and `src/lib/woocommerce-client-match.test.ts`.

## Search

`convex/globalSearch.ts`'s client scoring widens `ilikeFields`/`fuzzyFields` to
include every matched client's contacts' names/emails, fetched via a
**per-client drill** over `clientContacts.by_clientId`
(`collectByIndex(ctx, "clientContacts", "by_clientId", "clientId", allClients.map(...))`)
— a bounded per-client FK scan, not a 16th org-wide `orgScan` (see the
`SCAN_CAP` read-budget note at the top of that file). The result subtitle
prefers the resolved primary contact.

## Client detail page & table

- **Hero**: shows the resolved primary contact (name/email/phone) plus a
  `+N more` badge when the client has additional contacts.
- **Sidebar**: the old single-contact "Contact" section is replaced by
  `ClientContactsManager` (`src/components/clients/client-contacts-manager.tsx`)
  — an inline list + add/edit dialogs, same shape as
  `model-accessories-manager.tsx`. Gated on `client:update` via `CanDo`, with a
  `ReadOnlyContactsList` fallback for viewers (mirrors how
  `ModelAccessoriesManager` is gated on the model detail page).
- **Table columns**: `contactName`/`contactEmail` on `clients.listPage` are now
  primary-contact-derived server-side (falling back to the legacy fields) —
  `client-table.tsx` itself needed no changes, since it just renders whatever
  the query returns. Sort stays client-side JS, unchanged.

## Out of scope (explicitly deferred)

- **Narrow step** (drop the 3 legacy embedded fields + the 4 arg lists) — a
  separate follow-up PR.
- A standalone project-sidebar contact quick-editor (see "Per-project contact"
  above for the rationale).
- Any client-facing "which contact does this quote email go to" logic — a
  different workstream's concern per the original spec.

## Tests

- `convex/clientContactWrites.test.ts` — floor, duplicate-email-allowed, cap,
  auto-primary-on-first-contact, `setPrimaryNative` exclusivity,
  `removeNative` promote-on-delete, RBAC, cross-tenant rejection.
- `convex/backfillClientContacts.test.ts` — full/partial/empty embedded
  contacts, name synthesis, idempotency, dry-run.
- `convex/wooCommerceActions.test.ts` / `src/lib/woocommerce-client-match.test.ts`
  — email widen + fuzzy-match auto-create, both paths.
- `convex/validationDrift.test.ts` — `clientContactSchema` ↔ `clientContactFields`
  parity (R-8.6.1).
