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

/** 73 tables, each with a `by_organizationId` index. */
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
  "projectTasks",
  "savedTableViews",
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
  platform: ["siteSettings", "sentEmails", "organizations", "systemFlags"],
  // Ephemeral / live-only presence + preferences — no restore value.
  ephemeral: ["collaborationLocks", "collaborationPresence", "activityEvents", "userNotificationPreferences"],
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

export const EXPECTED_TABLE_COUNT = 99;

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
