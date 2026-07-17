# Feature Removal Plan — June 2026

> **SHIPPED — fully executed.** All 13 clusters confirmed removed (stocktake,
> utilization, reorder, workshop kanban, reports, social login, Discord,
> crew roles/skills/certs, and others below) — no matching code, routes, or
> schema fields remain. Archived here as a historical record.

Remove 13 feature clusters that are either unneeded right now or don't work.
Each cluster is an **independent, atomic PR** so they can be reviewed and reverted
separately. Convex tables/Prisma models are dropped only where the feature owns
them exclusively; shared infrastructure (AssetScanLog, accessories data model,
maintenance CRUD, notifications, outbox transaction layer, Better Auth
email/passkey, pdfme generator) stays.

Branching: each cluster on its own branch off `main`. Order matters only where one
cluster's nav/route removal overlaps another (scanner ↔ stocktake, accessories ↔
warehouse). Migrations come last within each PR and end with `ANALYZE` where bulk
data changes.

---

## Cross-cutting backbone

**Single nav file** drives most removals: `src/components/layout/app-sidebar.tsx`.
Entries to delete: Utilization (137), Stocktake (144), Reorder (145), Workshop
(146), Reports (184), "Roles & Skills" (174). Mobile nav scanner button:
`src/components/layout/mobile-nav.tsx`. Settings nav Discord: `src/app/(app)/settings/layout.tsx:82`.

**Permissions**: `src/lib/permissions.ts` — drop `stocktake` and `reports`
resources (verify no other consumer). Crew role/skill resource stays as `crew`.

**Convex schema** `convex/schema.ts` + `convex/lib/validators.ts` + generated
`convex/_generated/api.d.ts` need matching edits for every dropped table/enum.
Run `pnpm exec convex dev --once` after each Convex change.

**Migrations**: Prisma drops can't use `migrate dev` (pre-existing drift). Hand-author
SQL migrations + `migrate deploy`. Drop tables `CASCADE`. Backfills already in prod
mean prod Convex still has these tables — dropping the Convex table definition is safe
(orphan data, no reads).

---

## Cluster 1 — Stocktake (delete whole feature)

**Delete:** `src/server/stocktake.ts` (+`.int.test.ts`), `src/lib/stocktake-mirror.ts`,
`src/lib/validations/stocktake.ts` (+`.test.ts`), `src/hooks/use-stocktake.ts`,
`src/components/stocktake/` (folder), `src/app/(app)/warehouse/stocktake/` (folder),
`convex/stocktakes.ts`, `convex/stocktakeItems.ts`, `convex/stocktakeMirror.ts`,
`convex/stocktakeDetail.ts`, `scripts/convex-backfill-stocktake.ts`,
`scripts/convex-roundtrip-stocktake.ts`, `FEATUREDOCS/43-stocktake.md`,
`NEWFEATURES/17-stocktake.md`.

**Edit:** prisma/schema.prisma — drop `Stocktake`, `StocktakeItem`, enums
`StocktakeScope/Status/ItemResult`; drop relations on User/Organization/Location/Asset/BulkAsset.
convex/schema.ts — drop `stocktakes`, `stocktakeItems` tables. validators.ts — drop 3 enums.
api.d.ts — drop 4 exports. package.json — drop `convex:backfill:stocktake` script + remove
from `convex:backfill:all`. app-sidebar.tsx:144. permissions.ts — drop `stocktake` resource.

**Migration:** DROP TABLE stocktake_item, stocktake CASCADE; DROP TYPE the 3 enums.

**Risk:** `AssetScanLog` is NOT stocktake-owned — keep it. StocktakeItem.assetId/bulkAssetId
are SetNull — safe.

---

## Cluster 2 — Built-in QR/barcode scanner (camera input only)

Keep QR *generation* (`qrcode`, `react-qr-code`), keep `AssetScanLog`, keep manual
tag entry. Remove only camera capture.

**Delete:** `src/components/ui/barcode-scanner.tsx`, `src/components/ui/scan-input.tsx`.
package.json — drop `html5-qrcode`.

**Edit (replace `ScanInput`/`BarcodeScanner` with a plain text input that keeps the
existing onScan/lookup handler):** mobile-nav.tsx, maintenance-form.tsx, kits/[id]/page.tsx,
warehouse/{pick-prep,return,deploy}-tab.tsx, assets/asset-form.tsx, assets/bulk-asset-form.tsx,
kits/kit-form.tsx, warehouse/page.tsx, warehouse/[projectId]/page.tsx, check/[assetTag]/page.tsx,
test-and-tag/new/page.tsx, test-and-tag/quick-test/components/scan-step.tsx. Docs:
FEATUREDOCS/07, 12, 19.

**Approach:** introduce a tiny `TagInput` (text + submit, same props minus camera) so the
~13 call sites change one import and keep behaviour. Sequence AFTER stocktake (stocktake
deletes one of the ScanInput consumers).

**Risk:** every checkout/checkin still writes AssetScanLog via the manual path — verify.

---

## Cluster 3 — Utilisation tab (isolated, clean)

**Delete:** `src/app/(app)/utilization/page.tsx`, `src/server/utilization.ts`,
`src/lib/utilization.ts` (+`.int.test.ts`), `FEATUREDOCS/42-asset-utilization.md`.
**Edit:** app-sidebar.tsx:137. **Risk:** none — no shared consumers, no schema.

---

## Cluster 4 — Reorder tab

**Delete:** `src/app/(app)/warehouse/reorder/page.tsx`, `src/server/reorder.ts`,
`src/lib/reorder.ts` (+`.int.test.ts`), `FEATUREDOCS/44-reorder.md`.
**Edit:** app-sidebar.tsx:145. prisma BulkAsset — drop `reorderThreshold`,
`preferredSupplierId`(+relation), `lastReorderedAt`. convex/schema.ts + convex/bulkAssets.ts —
drop the 3 fields. `src/components/assets/bulk-asset-form.tsx` + `src/lib/validations/asset.ts` +
`src/server/bulk-assets.ts` — drop the form fields/validators/write-handling.

**DECISION (low-stock notifications):** `src/server/notifications.ts` (~220-235) emits
low-stock alerts using `reorderThreshold`. Removing reorder removes the threshold → remove
the low-stock notification block too. (Alternative: keep a simpler quantity==0 alert.)

**Migration:** drop FK + 3 columns from bulk_asset; ANALYZE.

---

## Cluster 5 — Workshop kanban tab

**Delete:** `src/app/(app)/workshop/page.tsx`, `FEATUREDOCS/41-workshop-kanban.md`.
**Edit:** `src/server/maintenance.ts` — delete `getWorkshopQueue()` + `setMaintenanceStatus()`
(kanban-only); KEEP all other maintenance CRUD/detail/list. app-sidebar.tsx:146.
maintenance-mirror.ts — comment only. Check maintenance-form.tsx status dropdown for
AWAITING_PARTS/QA options.

**DECISION (enum):** Workshop added `AWAITING_PARTS`, `QA` to `MaintenanceStatus`. No other
consumer. Keep the enum values dormant (dropping a Postgres enum value is fiddly and risks
existing rows) — only remove from any UI dropdown. Migration optional/skipped.

**Risk:** maintenance list/detail + damage→maintenance flow stay. Only the board view goes.

---

## Cluster 6 — Reports tab

**Delete:** `src/app/(app)/reports/` (folder), `src/app/api/reports/pdf/route.tsx`,
`src/app/api/cron/reports/route.ts`, `src/components/reports/` (folder),
`src/server/reports.ts`, `src/server/scheduled-reports.ts` (+`.int.test.ts`),
`src/lib/report-emails.ts`, report validators (+tests), `FEATUREDOCS/34-reporting-system.md`.
**Edit:** app-sidebar.tsx:184. permissions.ts — drop `reports` resource. prisma — drop
`SavedReport` + `ScheduleFrequency` enum. convex savedReports table + `convex/savedReports.ts` +
`scripts/convex-backfill-saved-reports.ts`. Remove from `convex:backfill:all`.

**SCOPE NOTE:** `/test-and-tag/reports` is a *different* feature (T&T compliance, recently
read-rewired to Convex — PR #194). Leave it. The user said "reports tab", which is the
general report builder.

**Migration:** DROP TABLE saved_report CASCADE; DROP TYPE ScheduleFrequency.

---

## Cluster 7 — Social login (OAuth providers)

Keep email/password + passkeys + SSO. Remove only Google/Microsoft OAuth.

**Delete:** `src/app/api/auth/social-providers/route.ts`.
**Edit:** `src/lib/auth.ts` — remove `socialProviders` block (keep SSO/passkey/etc).
`src/env.ts` — drop 4 OAuth env vars + pair-validation. env.test.ts. .env.example.
login/page.tsx — remove Google/Microsoft icons, buttons, handlers, fetch. account/page.tsx —
remove "Connected Accounts" section. admin/settings/page.tsx — remove the 2 toggles.
prisma SiteSettings — drop `socialLoginGoogle`, `socialLoginMicrosoft`. CLAUDE.md OAuth env note.

**DECISION (data):** leave existing Better Auth `account` rows for google/microsoft in place
(harmless; users just can't use those buttons). No destructive account-row migration.

**Migration:** drop 2 boolean columns from site_settings.

---

## Cluster 8 — Discord integration (whole feature)

**Delete:** `scripts/discord-bot.ts`, `src/lib/discord/` (folder, ~37 files),
`src/lib/services/discord-actor.ts`, `discord-link-service.ts`, `channel-sync-service.ts`
(+ their tests + `discord-link.int.test.ts`, `channel-sync.int.test.ts`),
`src/app/api/discord/` + `src/app/api/admin/discord/` (folders),
`src/app/(app)/settings/discord/page.tsx`, `src/server/discord-integration.ts`,
`src/lib/validations/discord-integration.ts`, `convex/discordIntegrations.ts`,
`discordAccountLinks.ts`, `discordLinkTokens.ts`, `discordOutboxes.ts`,
`FEATUREDOCS/49-discord-integration.md`, `docs/operations/discord-bot.md`,
`docs/designs/discord-bot-*.md` (4 files).

**Edit:** `ecosystem.config.js` — remove `gearflow-discord-bot` app. package.json — drop
`discord.js` + `bot:start` script. instrumentation.ts — comment. settings/layout.tsx:82.
`src/lib/services/outbox-service.ts` — remove `emitIfDiscordEnabled` + discordOutbox writes,
KEEP the transaction/email path. `asset-fault-service.ts`, `asset-service.ts` — strip Discord
emit calls + imports. prisma — drop `DiscordIntegration/Outbox/AccountLink/LinkToken` models +
2 enums + `Project.discordChannelId` + `DamageEvent.discordIdempotencyKey` + CrewMember/Org
relations. convex/schema.ts — drop 4 discord tables. .env.example/CLAUDE.md DISCORD vars.

**Risk (HIGH):** outbox-service is shared with the transaction layer. Email path must keep
working after Discord emit is removed — needs an integration test. Deploy main.yml already
moot (Coolify) but the pm2 discord line in CLAUDE.md deploy section is stale → update.

**Migration:** DROP TABLE discord_* CASCADE; drop 2 columns.

---

## Cluster 9 — Crew Roles & Skills + Certifications

KEEP: crew members, assignments, shifts, time entries, availability, planner,
timesheets, RBAC `CustomRole` (auth — totally separate). REMOVE: `CrewRole`, `CrewSkill`,
`CrewCertification`.

**Delete:** `convex/crewRoles.ts`, `convex/crewSkills.ts`, `convex/crewCertifications.ts`.
**Edit:** prisma — drop `CrewRole`, `CrewSkill`, `CrewCertification` models + enums
`CrewRateType`, `CrewCertStatus`; drop fields `CrewMember.{crewRoleId,skills,certifications}`,
`CrewAssignment.crewRoleId`, `Category.suggestedCrewRoles`, Org back-relations. convex/schema.ts
— drop 3 tables + crewRoleId fields on crewMembers/crewAssignments + categories.suggestedCrewRoles.
validators.ts — drop 2 enums. `src/server/crew.ts` — delete role/skill/cert CRUD actions; edit
getCrewMembers/ById/Extras to drop role/skill/cert includes. crew-mirror/crew-scheduling-mirror —
drop role/skill/cert mirror fns. validations/crew.ts — drop 3 schemas. use-crew.ts — drop
useCrewRoles/useCrewSkills. crew/settings/page.tsx (Roles+Skills tabs → likely delete page).
crew/[id]/page.tsx — remove Certifications tab/dialog. crew-member-form.tsx — remove role
dropdown + skills multiselect. crew-table.tsx — remove Skills column. app-sidebar.tsx:174.
org-export.ts/org-import.ts — drop crew role/skill/cert payload.

**⚠ USER-CHALLENGE / SCOPE:** `src/server/project-services.ts` has ~18 references to
`crewRoleId` (services let you assign a crew role to a project service, and `Category.
suggestedCrewRoles` drives crew suggestions). Removing CrewRole forces a decision on the
project-services crew workflow. See decision gate.

**Migration:** DROP TABLE crew_role, crew_skill, crew_certification, _CrewMemberToCrewSkill
CASCADE; drop columns; DROP TYPE 2 enums.

---

## Cluster 10 — PDF template builder (keep generation)

KEEP: `src/lib/pdfme/` generator pipeline, `@pdfme/{common,generator,pdf-lib,schemas}`,
built-in/system-default templates (read-only). REMOVE: the visual builder/designer.

**Delete:** `src/app/(designer)/` (folder), `src/components/settings/document-designer.tsx`,
`document-template-manager.tsx`, `src/components/settings/template-builder/` (folder, dnd-kit
builder). **Edit:** `src/server/document-templates.ts` — delete write actions
(update/publish/duplicate/delete/setDefault); KEEP read actions (getDocumentTemplates,
getDefaultTemplate, getTemplateById). template-editor/editor-nav-sidebar.tsx +
editor-top-bar.tsx — remove builder links. settings/documents/page.tsx — reduce to read/default
selection. package.json — drop `@pdfme/ui`. validations/document-template.ts — keep
DOCUMENT_TYPES, drop builder validators.

**DECISION (tables):** keep `DocumentTemplate` + `SectionPreset` tables in place but stop
all custom writes (system-default rows still read). NOT dropping them avoids a data migration
and keeps the generator's default-template lookup intact. (Alternative: drop SectionPreset,
keep DocumentTemplate.)

**Risk:** `@pdfme/ui` Designer is isolated to document-designer.tsx. Confirm no other import.

---

## Cluster 11 — Drag and drop

Three dnd-kit sites: (a) template-builder — removed by Cluster 10. (b) media-uploader gallery
reorder — *works*, user-facing. (c) equipment-tab/equipment-rows line-item reorder — the
"doesn't work" one.

**⚠ USER-CHALLENGE / SCOPE:** does "remove drag and drop" mean (i) only the broken equipment
line-item reorder, (ii) equipment + media gallery, or (iii) all dnd-kit? And if equipment
reorder goes, replace with up/down buttons (keep manual reordering) or drop reordering
entirely? See decision gate. `@dnd-kit/*` packages can only be removed if ALL sites go.

**Edit (if equipment only, with buttons):** equipment-tab.tsx — remove DndContext;
equipment-rows.tsx — remove useSortable, add up/down buttons calling a `reorderLineItem`
server action (check src/server/line-items.ts; create if absent).

---

## Cluster 12 — Accessories in warehouse prep/deploy/return view (narrow)

KEEP the entire accessories data model + asset/model accessory managers + PDF rendering +
checkout/checkin cascade (FEATUREDOCS/48). REMOVE only the warehouse-prep UI *display* of
accessory children.

**Delete:** `src/components/warehouse/accessory-child-rows.tsx` (+`.test.ts`).
**Edit:** warehouse/deploy-tab.tsx, return-tab.tsx — remove AccessoryChildRows import +
getAccessoryChildren render. pick-prep-tab.tsx — remove accessory rows if present.
equipment-rows.tsx — describeRow accessory-parent expansion (verify).

**⚠ SCOPE:** also remove accessories from pull-sheet PDF (`warehouse/[projectId]/pull-sheet`)
and `online-pick-list.tsx`? The user said "warehouse view when prepping/deploying" — narrowest
reading is the deploy/return/prep tabs only, leaving printed pull-sheets alone. See gate.

**Risk:** accessories still cascade at checkout/checkin in warehouse.ts — DO NOT touch that.
Background behaviour stays; only on-screen prep display goes.

---

## Cluster 13 — (covered above) docs + ARCHITECTURE.md

Update `ARCHITECTURE.md` feature table: remove rows 34, 41, 42, 43, 44, 49 and the crew
roles/skills/cert + scanner + PDF-builder mentions. Update CLAUDE.md (OAuth env vars,
Discord deploy line, scanner gotchas).

---

## Sequencing

1. Independent, zero-risk first: **Utilisation (3)**, **Reports (6)**, **Social login (7)**.
2. **Stocktake (1)** then **Scanner (2)** (scanner edits a file stocktake deletes).
3. **Reorder (4)**, **Workshop (5)** — independent schema trims.
4. **Discord (8)** — large, isolated, but shared outbox needs the email-path test.
5. **Crew roles/skills/certs (9)** — gated on the project-services decision.
6. **PDF builder (10)** + **Drag-and-drop (11)** — overlap on dnd-kit package removal.
7. **Accessories-in-warehouse (12)** — narrow UI trim.
8. Docs sweep (13) folded into each PR + a final ARCHITECTURE/CLAUDE pass.

Each PR: branch off main → delete/edit → `pnpm exec convex dev --once` → hand-author migration
→ `npm run build` + `npm test` → golden checks where Convex reads changed → Coolify preview
for data-correctness → merge.

---

## Review corrections (adversarial pass — folded in)

A second-voice pass found gaps that would break the build or a kept feature. Standing rule
for EVERY cluster that drops a Convex/Prisma table: also remove its **mirror, hook, backfill,
and generated-api consumers**, not just the Convex function file. Specifically:

- **Generated api**: `convex/_generated/api.d.ts` imports every dropped module (lines ~27-38,
  125-136, 171-179). Regenerate via `pnpm exec convex dev --once` after deleting the function
  files — do NOT hand-edit and forget consumers.
- **Reorder** also touches: `src/server/notification-email-sender.ts:231-241` (low-stock
  EMAIL, not just in-app), `src/lib/validations/notification-preferences.ts:64-66`,
  `src/server/notifications.int.test.ts:26-31`, `convex/schema.ts:564-577` + `convex/bulkAssets.ts:69-71`.
- **Social login** also: `convex/schema.ts:1384-1385` + `convex/siteSettings.ts:42-43,64-65,90-91`.
- **Discord** also removes emitters in KEPT files: `src/server/projects.ts:30,607,707,771` and
  `src/server/crew-assignments.ts:14,167,315`; delete `src/lib/services/outbox-service.ts`
  ENTIRELY (Discord-only — confirmed not shared with email; email uses `NotificationEmailLog`
  + Resend). The required test is "project/crew mutations still succeed after emit removal",
  NOT an email-path test.
- **Reports** also: `src/hooks/use-back-office.ts:16,25-26,46`, `src/lib/saved-reports-mirror.ts`,
  `scripts/convex-backfill-saved-reports.ts`, org-import/export (below).
- **Org import/export** references dropped payloads — must be trimmed (or made
  ignore-legacy-keys) whenever SavedReport / CrewRole / CrewSkill / CrewCertification drop:
  `src/lib/org-import.ts:633-642,818-838,847,872-884,898`; `src/lib/org-export.ts:64-71,129-132,241-247`.
- **Scanner**: remove dead overlay CSS `src/app/globals.css:468`.
- **PDF builder**: the documents settings page is NOT a clean read-only page today —
  `src/app/(app)/settings/documents/page.tsx:5-6,28-31` imports `DocumentTemplateManager`
  which calls write actions; `template-editor.tsx:9-12,132-133` calls `publishDocumentTemplate`
  + `saveTemplateSettings`; `src/server/section-presets.ts` exposes preset writes. So either
  delete the whole editor surface OR keep the write actions it needs — see Decision D4.

### Crew roles — the depth correction (drives Decision D1)
`CrewRole` is wired into KEPT features beyond project-services. Dropping the *model* breaks:
`src/server/crew-dashboard.ts:17,22`, `src/server/crew-communication.ts:31,53`,
`src/server/search.ts:263-274` (raw SQL `crew_role` join), `src/app/api/calendar/[token]/[feed]/route.ts:314-332`,
`src/lib/pdfme/build-document-data.ts:190-208` (call-sheet role display),
`src/app/api/documents/call-sheet/[projectId]/route.tsx:13-14`,
`src/components/projects/call-sheet-dialog.tsx:126-132,187-188`, plus FK relations on
`CrewMember/CrewAssignment/ProjectService`. `crewRoleId` is *optional* everywhere (SetNull),
so it can be dropped, BUT role LABELS currently appear on call sheets and in search/dashboard.
This is a product decision, not a mechanical one. → **D1**.

---

## LOCKED DECISIONS (user-approved 2026-06-17)

- **D1 = A** — Stop managing crew roles/skills, keep the labels. Remove the Roles & Skills
  settings UI/nav/skills-column/cert-tab/pickers + create-edit-delete actions. KEEP
  `CrewRole`/`CrewSkill` models as read-only lookups (call sheets, search, dashboard, calendar
  keep their role labels — no document/search changes). Remove **Certifications fully**
  (`CrewCertification` model, convex table, server actions, cert tab, mirror). → Cluster 9 is
  now SMALL: no project-services/call-sheet/search refactor, no CrewRole/CrewSkill table drop.
  Only `CrewCertification` drops. Keep `crewRoleId`/`suggestedCrewRoles` columns intact.
- **D2 = B** — Remove accessories from ALL warehouse prep surfaces: deploy/return/pick-prep
  tabs + `online-pick-list.tsx` + `pull-sheet/page.tsx`. Data model + cascade untouched.
- **D3 = Remove ALL drag-and-drop** — equipment line-item reorder AND media-gallery reorder.
  Drop `@dnd-kit/{core,sortable,utilities}`. Equipment reorder replaced with up/down buttons
  (buttons ≠ DnD; preserves document line ordering via a `reorderLineItem` action). Media
  reorder removed (gallery keeps upload order, no manual reorder).
- **D4 = A** — Thin PDF config. Delete builder/designer/template-manager/editor + `@pdfme/ui` +
  SectionPreset writes. Keep a minimal page to pick the default built-in template per doc type
  (`getDocumentTemplates`/`getDefaultTemplate`/`getTemplateById`/`setDefaultTemplate`).
- **D5 = remove** — low-stock notifications (in-app + email) go with Reorder.

(Original options retained below for the record.)

## Decisions for the approval gate

**D1 — Crew Roles & Skills: how deep?**
- (A, recommended) *Stop managing, keep the labels.* Remove the "Roles & Skills" settings UI +
  nav + skills column + the create/edit/delete actions + the crew-member-form pickers. KEEP the
  `CrewRole`/`CrewSkill` models as read-only lookups so call sheets, search, dashboard, calendar
  keep rendering existing role labels. Remove **Certifications fully** (no downstream consumers).
  Smallest blast radius, no document/search regressions.
- (B) *Full excision.* Convert role to denormalized free-text `crewRoleName`, strip role from
  call sheets/search/calendar/dashboard, migrate data, drop the tables. Large refactor across
  kept document generation.

**D2 — Accessories in warehouse: scope.**
- (A) Screen prep tabs only (deploy/return/pick-prep) — leave printed pull-sheet PDF + online
  pick list showing accessories.
- (B, recommended) All prep surfaces including `online-pick-list.tsx` + `pull-sheet/page.tsx`
  (consistent — accessories disappear from the whole prep/deploy flow, screen and print).

**D3 — Drag-and-drop: scope + replacement.**
- Sites: (i, recommended) equipment line-item reorder only (the broken one) + builder (already
  gone with D4); KEEP media-uploader gallery DnD (it works). (ii) also remove media DnD.
- Replacement for equipment reorder: (recommended) up/down buttons calling a `reorderLineItem`
  action (keeps ordering, which matters for document line order) vs. drop reordering entirely.
- `@dnd-kit/*` packages stay unless ALL sites go.

**D4 — PDF document settings surface.**
- (A, recommended) *Thin config.* Delete the visual builder/designer/template-manager/editor +
  `@pdfme/ui` + SectionPreset writes; keep a minimal page to pick the default built-in template
  per doc type (keep `getDocumentTemplates/getDefaultTemplate/getTemplateById` + `setDefaultTemplate`).
- (B) *Zero config.* Remove the entire document-settings surface; defaults hardcoded.

**D5 (auto-decided, overridable) — Low-stock notifications** go away with Reorder (in-app +
email), since they depend on `reorderThreshold`. Override if you want a simpler quantity==0 alert kept.
