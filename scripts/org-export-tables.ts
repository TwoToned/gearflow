/**
 * AUTHORITATIVE table classification for the semantic per-org export.
 *
 * Shared by `scripts/export-org.ts` (the exporter) and `convex/orgExport.test.ts`
 * (the coverage guard). The "no silent caps" contract: every one of the Convex
 * schema's tables must appear in exactly one bucket below. The coverage test
 * parses `convex/schema.ts` and fails if the schema grows a table this file
 * doesn't classify — so a new table makes the build FAIL, never silently drop.
 *
 * Buckets
 * -------
 *  • DIRECT_TABLES     — has a `by_organizationId` index; page via that index.
 *  • FILTER_TABLES     — has an org column but NO `by_organizationId` index; export
 *                        by full-table scan + `.filter()` on the named org field.
 *                        Covers `storedFiles` (organizationId) AND the three
 *                        collaboration tables commentThreads/comments/reviewMarkers,
 *                        which carry a direct `orgId` field. (The task listed those
 *                        three under "parent-join", but each has its own org field,
 *                        so a filtered scan on `orgId` is exact and does NOT depend
 *                        on which parent entities were exported — the cleanest
 *                        resolution. Documented here + in the exporter.)
 *  • PARENT_JOIN       — true children with NO org column; collect via their
 *                        org-scoped parent's cuid ids over the child's FK index.
 *  • EXCLUDED          — auth / platform-global / ephemeral, each with a reason.
 *                        `organizations` is exported separately as `orgRow`.
 */

export const SCHEMA_VERSION = "1";

/** 77 tables, each with a `by_organizationId` index. */
export const DIRECT_TABLES = [
  "activityLogs",
  "apiKeys",
  "assetBulkChildren",
  "assetMedia",
  "assets",
  "assetScanLogs",
  "bulkAssets",
  "categories",
  "checkItems",
  "checkRecords",
  "clientContacts",
  "clientMedia",
  "clients",
  "crewAssignments",
  "crewAvailabilities",
  "crewMembers",
  "crewRoles",
  "crewSkills",
  "crewTimeEntries",
  "customFieldDefinitions",
  "dashboardCounters",
  "fileUploads",
  "groupTemplateItems",
  "groupTemplates",
  "invitations",
  "invoices",
  "kitBulkItems",
  "kitCheckItems",
  "kitMedia",
  "kitRevenueAllocations",
  "kits",
  "kitSerializedItems",
  "lineItemMergeMaps",
  "locationMedia",
  "locations",
  "maintenanceRecords",
  "members",
  "modelBulkAccessories",
  "modelCheckItems",
  "modelMedia",
  "models",
  "notificationDismissals",
  "notificationEmailLogs",
  "orgSettings",
  "pendingSSOApprovals",
  "projectCategories",
  "projectGroups",
  "projectLineItems",
  "projectLineItemUnits",
  "projectManagers",
  "projectMedia",
  "projectModelRevenues",
  "projectNumberSequences",
  "projects",
  "projectServices",
  "projectSnapshotEntries",
  "projectSnapshots",
  "projectTasks",
  "projectUnlockSessions",
  "quotes",
  "savedTableViews",
  "serviceSchedules",
  "serviceTemplates",
  "ssoProviders",
  "subHireMedia",
  "subHires",
  "supplierModelRates",
  "supplierOrders",
  "suppliers",
  "testProfiles",
  "testTagAssets",
  "testTagAuditorTokens",
  "testTagRecords",
  "warehouseCloses",
  "warehouseDashboardTokens",
  "webhookDeliveries",
  "webhooks",
  "wooCommerceIntegrations",
  "wooCommerceOrderLogs",
  // WS1 (#940) — Xero integration config + audit log.
  "xeroIntegrations",
  "xeroSyncLogs",
] as const;

/** Tables with an org column but no `by_organizationId` index → filtered scan. */
export const FILTER_TABLES = [
  { table: "storedFiles", orgField: "organizationId" },
  { table: "commentThreads", orgField: "orgId" },
  { table: "comments", orgField: "orgId" },
  { table: "reviewMarkers", orgField: "orgId" },
] as const;

/**
 * Children with no org column. `field` is the FK on the child; `index` is the
 * child's single-field index on that FK; `parentTable` supplies the org-scoped
 * cuid ids we join against (parent already exported via DIRECT).
 */
export const PARENT_JOIN = [
  { table: "supplierOrderItems", parentTable: "supplierOrders", index: "by_orderId", field: "orderId" },
  { table: "subHireItems", parentTable: "subHires", index: "by_subHireId", field: "subHireId" },
  { table: "subHireGroups", parentTable: "subHires", index: "by_subHireId", field: "subHireId" },
  { table: "crewShifts", parentTable: "crewAssignments", index: "by_assignmentId", field: "assignmentId" },
  { table: "maintenanceRecordAssets", parentTable: "maintenanceRecords", index: "by_maintenanceRecordId", field: "maintenanceRecordId" },
  { table: "subTestRecords", parentTable: "testTagRecords", index: "by_testTagRecordId", field: "testTagRecordId" },
  { table: "categorySlots", parentTable: "projectCategories", index: "by_projectCategoryId", field: "projectCategoryId" },
  // WS1 (#940) — invoiceLines has no organizationId column by design (joined
  // via invoiceId into an already org-scoped `invoices` row).
  { table: "invoiceLines", parentTable: "invoices", index: "by_invoiceId", field: "invoiceId" },
] as const;

/** Excluded with reason. `organizations` handled separately as `orgRow`. */
export const EXCLUDED = {
  // Better Auth machinery — credentials/sessions, not domain data.
  // passkeys is a Better Auth WebAuthn credential — it has NO by_organizationId
  // index (by_cuid/by_userId/by_credentialID only), so it's auth, not domain data.
  auth: ["accounts", "backupCodes", "jwkses", "passkeys", "sessions", "twoFactors", "users", "verifications"],
  // Platform/global, not per-org restore state.
  // systemFlags is a platform-global singleton (the browser-write kill-switch) —
  // operational state, not per-org domain data.
  // oauthClients (Phase 7, #1003) is a global registry of dynamically-
  // registered MCP OAuth clients (RFC 7591) — no `organizationId` column at
  // all, same posture as Better Auth's own client/session tables: platform
  // infrastructure a single org export cannot meaningfully restore or scope.
  platform: ["siteSettings", "sentEmails", "organizations", "systemFlags", "oauthClients"],
  // Ephemeral / live-only presence + preferences — no restore value.
  // apiIdempotency is the API/MCP replay ledger: short-lived dedup rows whose
  // `result` blobs are cached copies of data the real tables already hold.
  // Restoring them would let a stale key replay into a fresh org, and exporting
  // them would duplicate row contents outside their own table's redaction path.
  // apiRequestLog is the API/MCP per-key request log (#998): observability rows
  // (ts/operation/status/latency + redacted args) with a 30-day retention cron,
  // not domain data — same exclusion rationale as apiIdempotency.
  // oauthAuthorizationCodes (Phase 7, #1003) has an `organizationId` column
  // but no `by_organizationId` index (it's the one-shot authorization_code
  // hop, redeemed within a single HTTP round trip and expiring in ~120s) —
  // same "restoring a dead short-lived credential has no value" rationale as
  // apiIdempotency, so excluded rather than added to FILTER_TABLES.
  // miraKeys (Phase 8, #1004) holds an ENCRYPTED bearer secret per (org, user) —
  // Mira's own internal apiKeys binding. Exporting it would move an encrypted
  // credential outside the vault's own org/key context; restoring it into a
  // fresh org would let stale ciphertext authenticate against a key row that no
  // longer matches it. Re-provisions itself lazily on next use either way.
  ephemeral: [
    "activityEvents",
    "userNotificationPreferences",
    "apiIdempotency",
    "apiRequestLog",
    "oauthAuthorizationCodes",
    "miraKeys",
  ],
} as const;

/**
 * `*Media` tables (all also in DIRECT) plus their owning entity ref field. Used
 * to build the file manifest alongside `storedFiles`.
 */
export const MEDIA_TABLES = [
  { table: "modelMedia", refField: "modelId" },
  { table: "assetMedia", refField: "assetId" },
  { table: "kitMedia", refField: "kitId" },
  { table: "projectMedia", refField: "projectId" },
  { table: "clientMedia", refField: "clientId" },
  { table: "locationMedia", refField: "locationId" },
  { table: "subHireMedia", refField: "subHireId" },
] as const;

export const EXPORTED_TABLES: string[] = [
  ...DIRECT_TABLES,
  ...FILTER_TABLES.map((f) => f.table),
  ...PARENT_JOIN.map((p) => p.table),
];

export const EXCLUDED_TABLES: string[] = [
  ...EXCLUDED.auth,
  ...EXCLUDED.platform,
  ...EXCLUDED.ephemeral,
];

/** Full classified set — the coverage guard asserts this equals the schema. */
export const CLASSIFIED_TABLES: string[] = [...EXPORTED_TABLES, ...EXCLUDED_TABLES];

// WS1 (#940): +5 — quotes, invoices, invoiceLines, xeroIntegrations, xeroSyncLogs.
// #997: +1 — apiIdempotency (EXCLUDED/ephemeral, the API replay ledger).
// #998: +1 — apiRequestLog (EXCLUDED/ephemeral, the API request log).
// Project-locks removal: -2 — collaborationLocks, collaborationPresence dropped from schema.
// #1003: +2 — oauthClients (EXCLUDED/platform, global DCR registry), oauthAuthorizationCodes
// (EXCLUDED/ephemeral, the one-shot authorization_code hop).
// #1004: +1 — miraKeys (EXCLUDED/ephemeral, Mira's own encrypted-at-rest apiKeys binding).
export const EXPECTED_TABLE_COUNT = 112;

/**
 * Assert the classification is internally consistent (no dupes, expected total).
 * Throws with a precise message. Returns the classified set on success.
 */
export function assertClassificationIntegrity(): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of CLASSIFIED_TABLES) {
    if (seen.has(t)) dupes.push(t);
    seen.add(t);
  }
  if (dupes.length) {
    throw new Error(`org-export classification has duplicate tables: ${dupes.join(", ")}`);
  }
  if (seen.size !== EXPECTED_TABLE_COUNT) {
    throw new Error(
      `org-export classification covers ${seen.size} tables, expected ${EXPECTED_TABLE_COUNT}. ` +
        `Every schema table must be classified (DIRECT / FILTER / PARENT_JOIN / EXCLUDED).`,
    );
  }
  return CLASSIFIED_TABLES;
}

/**
 * Coverage guard against the live schema table list: throws if any schema table
 * is unclassified, or any classified name is not in the schema.
 */
export function assertCoverage(schemaTables: string[]): void {
  assertClassificationIntegrity();
  const classified = new Set(CLASSIFIED_TABLES);
  const schema = new Set(schemaTables);

  const unclassified = schemaTables.filter((t) => !classified.has(t));
  if (unclassified.length) {
    throw new Error(
      `Unclassified schema table(s) — export would SILENTLY DROP data: ${unclassified.join(", ")}. ` +
        `Add each to scripts/org-export-tables.ts (DIRECT / FILTER / PARENT_JOIN / EXCLUDED).`,
    );
  }
  const phantom = CLASSIFIED_TABLES.filter((t) => !schema.has(t));
  if (phantom.length) {
    throw new Error(
      `Classified table(s) not present in convex/schema.ts (stale classification): ${phantom.join(", ")}.`,
    );
  }
}
