import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as enums from "./lib/validators";

/**
 * RVLT Flow Convex schema — generated from prisma/schema.prisma (Phase 1).
 *
 * 101 tables mirroring the Prisma models (100, +1 `serviceSchedules` — WS6 #945,
 * a Convex-native table with no Prisma equivalent, see below). Conventions:
 *  - The Prisma primary cuid `@id` is PRESERVED as a stored `id: v.string()`
 *    field with a `by_cuid` index — NOT dropped in favour of Convex's `_id`. The
 *    app holds cuids everywhere (URLs, FK strings, server-action args), so every
 *    lookup keys off `id`; Convex's own `_id` stays internal/unused.
 *  - Foreign keys are stored as `v.string()` (the source cuid) during the hybrid
 *    migration — NOT v.id() — so Convex docs interoperate with the existing
 *    Prisma id space and with auth-owned entities (user/organization) that stay
 *    in Better Auth. FK fields drive indexes. (Native v.id() is a post-data-
 *    migration optimization.) See FEATUREDOCS/54.
 *  - DateTime/Decimal -> v.number(); Json -> v.any(); enums -> ./lib/validators.
 *  - Optional iff the Prisma field is nullable, has a default, is a list, or is
 *    @updatedAt (so inserts/migration backfill aren't forced to set them).
 *  - createdAt/updatedAt are kept (optional) to preserve migrated timestamps;
 *    Convex also exposes _creationTime automatically.
 *  - @unique is NOT enforced by Convex indexes — uniqueness is enforced in the
 *    mutations that own each table. The by_<field> index still exists for lookup.
 *
 * DO NOT blindly regenerate. This file has diverged from the generator on purpose:
 * it carries hand-added search indexes and composite indexes the generator never
 * emits, and (Phase C) several Convex tables whose Prisma models have already been
 * stripped. `node scripts/generate-convex-schema.cjs .` currently emits 91 tables
 * against these 98 — running it over this file DELETES live tables. Use it to see
 * what a new Prisma model *would* emit (generate into a scratch dir and diff), then
 * hand-merge that stanza here.
 */
export default defineSchema({
  // User
  users: defineTable({
    id: v.string(),
    name: v.string(),
    email: v.string(),
    emailVerified: v.optional(v.boolean()),
    image: v.optional(v.string()),
    role: v.optional(v.string()),
    banned: v.optional(v.boolean()),
    banReason: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    twoFactorEnabled: v.optional(v.boolean()),
  })
    .index("by_cuid", ["id"])
    .index("by_email", ["email"]),

  // Session
  sessions: defineTable({
    id: v.string(),
    expiresAt: v.number(),
    token: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    userId: v.string(),
    activeOrganizationId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),

  // Account
  accounts: defineTable({
    id: v.string(),
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    idToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    password: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"]),

  // Verification
  verifications: defineTable({
    id: v.string(),
    identifier: v.string(),
    value: v.string(),
    expiresAt: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"]),

  // Jwks
  jwkses: defineTable({
    id: v.string(),
    publicKey: v.string(),
    createdAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"]),

  // Organization
  organizations: defineTable({
    id: v.string(),
    name: v.string(),
    slug: v.string(),
    logo: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    metadata: v.optional(v.string()),
    defaultTaxRate: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_slug", ["slug"]),

  // Member
  members: defineTable({
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    role: v.string(),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    // Native-read-layer RBAC: requireOrgPermission resolves a user's role by
    // (org, user) in one indexed lookup.
    .index("by_org_user", ["organizationId", "userId"]),

  // Invitation
  invitations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    email: v.string(),
    role: v.optional(v.string()),
    status: v.string(),
    expiresAt: v.number(),
    inviterId: v.string(),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // SsoProvider
  ssoProviders: defineTable({
    id: v.string(),
    issuer: v.string(),
    oidcConfig: v.optional(v.string()),
    samlConfig: v.optional(v.string()),
    userId: v.optional(v.string()),
    providerId: v.string(),
    organizationId: v.optional(v.string()),
    domain: v.string(),
    domainVerified: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_providerId", ["providerId"])
    .index("by_domain", ["domain"]),

  // PendingSSOApproval
  pendingSSOApprovals: defineTable({
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    idpGroups: v.optional(v.array(v.string())),
    suggestedRole: v.optional(v.string()),
    providerId: v.string(),
    status: v.optional(enums.SSOApprovalStatus),
    reviewedById: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_reviewedById", ["reviewedById"])
    .index("by_organizationId_userId", ["organizationId", "userId"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // ApiKey — agent-accessible API/MCP access keys (docs/designs/api-mcp-agent-access.md).
  // `by_tokenHash` is the auth verify path (the token IS the credential, so a global
  // lookup by hash is correct — like by_cuid; the found key carries its own orgId).
  apiKeys: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    prefix: v.string(),
    tokenHash: v.string(),
    scopes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    actingUserId: v.string(),
    createdById: v.string(),
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    lastRotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_actingUserId", ["actingUserId"]),

  // ApiIdempotency — the API/MCP write-replay ledger
  // (docs/designs/api-mcp-reimplementation.md §9). Three-step per write:
  // `claim` (insert PENDING) -> run the operation -> `complete` (DONE + result).
  // A replay of a DONE key returns the stored `result` with `replayed: true` — a
  // SUCCESS, not an error; a still-PENDING key returns the retryable
  // `IDEMPOTENT_IN_PROGRESS`; the same key with a different `argsHash` is
  // `IDEMPOTENCY_KEY_REUSED`, never a silent divergent write.
  //
  // This ledger is deliberately NOT atomic with the effect. The real double-write
  // defence is deterministic id derivation — the entity `id` and `auditId` are
  // derived from (idempotencyKey, operation), so a retry after a crash between
  // "run" and "complete" re-derives the same id and the mutation's own by_cuid
  // duplicate guard rejects the second insert even when the ledger is stale.
  // Making it atomic would mean threading an idempotency arg through 223
  // mutations for a guarantee determinism already provides (decision 8).
  //
  // `by_org_key` is the claim/replay lookup; `by_apiKeyId` backs the per-key
  // request log and the Phase-4 `revertAgentWindow` sweep.
  apiIdempotency: defineTable({
    organizationId: v.string(),
    apiKeyId: v.string(),
    key: v.string(),
    operation: v.string(),
    argsHash: v.string(),
    status: v.union(v.literal("PENDING"), v.literal("DONE")),
    result: v.optional(v.any()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org_key", ["organizationId", "key"])
    .index("by_apiKeyId", ["apiKeyId"]),

  // StoredFile — the org-association for a Convex-storage file (the byte store is
  // Convex `_storage`). The /api/files proxy authorises a serve by looking up this
  // record's org (replacing the old S3 org-prefixed-key path auth). organizationId
  // "avatars" = global (user avatars, viewable by any authed user); any other value =
  // org-scoped (only that org's members). See src/lib/storage.ts.
  storedFiles: defineTable({
    storageId: v.string(),
    organizationId: v.string(),
    folder: v.optional(v.string()),
    fileName: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_storageId", ["storageId"]),

  // Webhook — outbound event endpoints (docs/designs/webhooks.md). The delivery
  // WORKER (HTTP send, HMAC signing, cron) stays in Next.js server code; only the
  // data lives here.
  webhooks: defineTable({
    id: v.string(),
    organizationId: v.string(),
    description: v.string(),
    url: v.string(),
    events: v.optional(v.string()), // JSON array of event names, default "[]"
    secret: v.string(),
    previousSecret: v.optional(v.string()),
    previousSecretExpiresAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    disabledAt: v.optional(v.number()),
    consecutiveFailures: v.optional(v.number()),
    lastDeliveryAt: v.optional(v.number()),
    createdById: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // WebhookDelivery — the delivery queue + operator-facing delivery log.
  // `by_status_nextAttemptAt` is the worker's claim query (PENDING + backoff elapsed);
  // it is a GLOBAL scan (the cron worker processes all orgs).
  webhookDeliveries: defineTable({
    id: v.string(),
    organizationId: v.string(),
    webhookId: v.string(),
    event: v.string(),
    payload: v.string(),
    status: v.optional(v.string()), // "PENDING" | "SUCCEEDED" | "FAILED"
    attempts: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    responseStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_webhookId", ["webhookId"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"]),

  // Category
  categories: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    suggestedCrewRoles: v.optional(v.array(v.string())),
    // WS1 (#940) — Xero account-coding cascade, level 3 (category default). Only
    // rendered/editable when the org has Xero linked (isXeroLinked); stored value
    // is retained but inert while unlinked. See convex/lib/xeroAccountCascade.ts.
    xeroAccountCode: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_parentId", ["parentId"]),

  // Model
  models: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    manufacturer: v.optional(v.string()),
    modelNumber: v.optional(v.string()),
    sku: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    manuals: v.optional(v.array(v.string())),
    specifications: v.optional(v.any()),
    customFields: v.optional(v.any()),
    defaultRentalPrice: v.optional(v.number()),
    dailyRate: v.optional(v.number()),
    weeklyRate: v.optional(v.number()),
    monthlyRate: v.optional(v.number()),
    defaultPurchasePrice: v.optional(v.number()),
    replacementCost: v.optional(v.number()),
    // WS11 (#950) — sales items. `salePrice` auto-prices a `type: "SALE"` line
    // (no fallback chain — unset requires manual entry, spec decision).
    // `saleStockQuantity` is a SINGLE per-model sale-stock pool, independent of
    // rental assets/bulk (decision: "we sell *a* SM58, not *our* SM58" —
    // new-stock sales decrement/restore THIS field, never a bulkAssets row).
    // Oversell is allowed (warn, never block); negative feeds the Overbookings
    // & Gaps board's "Sale stock to procure" section (convex/lib/overbookingBoard.ts).
    // Supersedes the WS3 (#942) `bulkAssets.saleStockQuantity` stub below, which
    // this workstream leaves in place (unused by the board from here on) rather
    // than migrating/dropping, to avoid a churny schema edit for an inert field.
    salePrice: v.optional(v.number()),
    saleStockQuantity: v.optional(v.number()),
    weight: v.optional(v.number()),
    powerDraw: v.optional(v.number()),
    requiresTestAndTag: v.optional(v.boolean()),
    testAndTagIntervalDays: v.optional(v.number()),
    defaultEquipmentClass: v.optional(enums.EquipmentClass),
    defaultApplianceType: v.optional(enums.ApplianceType),
    defaultTestProfileId: v.optional(v.string()),
    // DEPRECATED (WS6 #945): superseded by `serviceSchedules` (fixed interval +
    // anchor date, not "N days since last service"). The one-time migrate
    // backfill (backfillMaintenanceSchedules.ts) seeds one schedule per model
    // that had this set (days -> nearest month). Removed from modelSchema/
    // model-form.tsx — the interactive create/edit form no longer reads or
    // writes it. Deliberately left wired in convex/models.ts's generic CRUD
    // (create/createIfMissing/update) and convex/modelWrites.ts, because CSV
    // bulk import/export (src/server/csv.ts) still reads/writes this column
    // directly via `api.models.createIfMissing`/`update` — migrating THAT
    // surface to serviceSchedules is a separate follow-up, out of scope here.
    // Left readable/nulled-out on old rows rather than dropped from the schema
    // in this PR — mirrors the WS9 clientContacts widen/migrate-now,
    // narrow/drop-later precedent — so a schema-strictness deploy doesn't race
    // the backfill actually being run in prod. Remove this field once the
    // backfill is confirmed in prod AND the CSV import/export surface is
    // migrated too.
    maintenanceIntervalDays: v.optional(v.number()),
    assetType: v.optional(enums.AssetType),
    barcodeLabelTemplate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    // WS1 (#940) — Xero account-coding cascade, level 2 (model default), split
    // rental vs sale sides. `xeroSaleAccountCode` pairs with the future WS11/#950
    // sales-stock flow — the field exists now, no sale workflow is built here.
    // Xero-gated in the UI (categories/models/kits form's collapsed "Xero coding"
    // section); see convex/lib/xeroAccountCascade.ts.
    xeroRentalAccountCode: v.optional(v.string()),
    xeroSaleAccountCode: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_categoryId", ["categoryId"])
    .index("by_defaultTestProfileId", ["defaultTestProfileId"])
    .index("by_organizationId_sku", ["organizationId", "sku"])
    .index("by_isActive", ["isActive"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId", "isActive"] })
    // Second index so the model picker (label = "{manufacturer} {name}") matches a
    // manufacturer term too — merged with name hits in convex/search.ts, the same
    // multi-index pattern assets uses for assetTag + serialNumber (no denormalized
    // field / backfill needed).
    .searchIndex("search_manufacturer", { searchField: "manufacturer", filterFields: ["organizationId", "isActive"] }),

  // Supplier
  suppliers: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    notes: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultLeadTime: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_name", ["organizationId", "name"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId", "isActive"] }),

  // SupplierOrder
  supplierOrders: defineTable({
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    // Invoice attachment (issue #789) — single-file 1:1 FK to fileUploads, not a
    // *Media join table: an order has at most one invoice, so the reorder/
    // multi-file/primary-photo machinery in convex/mediaWrites.ts would be
    // over-engineering for this shape (R-3.1 — model the actual cardinality).
    invoiceFileId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_supplierId", ["supplierId"])
    .index("by_projectId", ["projectId"])
    .index("by_createdById", ["createdById"])
    .index("by_organizationId_supplierId", ["organizationId", "supplierId"])
    .index("by_organizationId_orderNumber", ["organizationId", "orderNumber"]),

  // SupplierOrderItem
  supplierOrderItems: defineTable({
    id: v.string(),
    orderId: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_orderId", ["orderId"])
    .index("by_modelId", ["modelId"])
    .index("by_assetId", ["assetId"]),

  // SubHire
  subHires: defineTable({
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    projectId: v.optional(v.string()),
    createdById: v.string(),
    orderNumber: v.string(),
    supplierReference: v.optional(v.string()),
    status: v.optional(enums.SubHireStatus),
    hireStart: v.optional(v.number()),
    hireEnd: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    totalCharge: v.optional(v.number()),
    pricingMode: v.optional(enums.SubHirePricingMode),
    orderTotalCost: v.optional(v.number()),
    orderTotalCharge: v.optional(v.number()),
    showOnDocs: v.optional(v.boolean()),
    paymentStatus: v.optional(enums.SubHirePaymentStatus),
    notes: v.optional(v.string()),
    defaultTargetCategoryId: v.optional(v.string()),
    defaultTargetGroupId: v.optional(v.string()),
    // WS7 #946 — 1:1 link to the purchase order raised with the supplier for this
    // sub-hire (the FK the data-linkage workstream adds; see FEATUREDOCS/39). Org- +
    // same-supplier-validated in convex/subHiresWrites.ts (assertRefInOrg + an
    // explicit supplierId match — a link only makes sense when both sides name the
    // same supplier). Cleared automatically when either side's supplier changes
    // (asset-form `supplierOrderId` precedent, issue #789). NOT copied by
    // duplicateSubHireNative — a duplicated sub-hire starts unlinked.
    supplierOrderId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_supplierId", ["supplierId"])
    .index("by_projectId", ["projectId"])
    .index("by_createdById", ["createdById"])
    .index("by_defaultTargetCategoryId", ["defaultTargetCategoryId"])
    .index("by_defaultTargetGroupId", ["defaultTargetGroupId"])
    .index("by_organizationId_orderNumber", ["organizationId", "orderNumber"])
    .index("by_organizationId_supplierId", ["organizationId", "supplierId"])
    .index("by_organizationId_status", ["organizationId", "status"])
    .index("by_organizationId_projectId", ["organizationId", "projectId"])
    .index("by_supplierOrderId", ["supplierOrderId"]),

  // SubHireItem
  subHireItems: defineTable({
    id: v.string(),
    subHireId: v.string(),
    groupId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    description: v.string(),
    quantity: v.optional(v.number()),
    unitCost: v.optional(v.number()),
    unitCharge: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    showOnQuote: v.optional(v.boolean()),
    showOnDocs: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    targetCategoryId: v.optional(v.string()),
    targetGroupId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_subHireId", ["subHireId"])
    .index("by_groupId", ["groupId"])
    .index("by_modelId", ["modelId"])
    .index("by_targetCategoryId", ["targetCategoryId"])
    .index("by_targetGroupId", ["targetGroupId"]),

  // SubHireGroup
  subHireGroups: defineTable({
    id: v.string(),
    subHireId: v.string(),
    title: v.string(),
    sortOrder: v.optional(v.number()),
    quantity: v.optional(v.number()),
    cost: v.optional(v.number()),
    charge: v.optional(v.number()),
    discount: v.optional(v.number()),
    showOnQuote: v.optional(v.boolean()),
    showOnDocs: v.optional(v.boolean()),
    targetCategoryId: v.optional(v.string()),
    targetGroupId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_subHireId", ["subHireId"])
    .index("by_targetCategoryId", ["targetCategoryId"])
    .index("by_targetGroupId", ["targetGroupId"]),

  // SupplierModelRate
  supplierModelRates: defineTable({
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    modelId: v.string(),
    lastUnitCost: v.number(),
    pricingType: v.optional(enums.PricingType),
    lastUsedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_supplierId", ["supplierId"])
    .index("by_modelId", ["modelId"])
    .index("by_organizationId_supplierId_modelId", ["organizationId", "supplierId", "modelId"])
    .index("by_organizationId_supplierId", ["organizationId", "supplierId"])
    .index("by_organizationId_modelId", ["organizationId", "modelId"]),

  // Kit
  kits: defineTable({
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isPrep: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    // WS1 (#940) — Xero account-coding cascade, level 2 (kit default, kit parent
    // lines only — see xeroAccountCascade.ts). Xero-gated in the UI.
    xeroAccountCode: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_categoryId", ["categoryId"])
    .index("by_locationId", ["locationId"])
    .index("by_organizationId_assetTag", ["organizationId", "assetTag"])
    .index("by_status", ["status"])
    .index("by_isActive", ["isActive"])
    // isPrep is a filterField so the picker can exclude prep kits IN the search
    // (exact parity with the old `isActive===true && isPrep===false` JS filter) —
    // no post-filtering the bounded page (which could drop valid non-prep matches).
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId", "isActive", "isPrep"] })
    // Second index so the kit picker (label = "{assetTag} - {name}") matches a tag
    // term too — merged with name hits in convex/search.ts (the assets tag+serial
    // pattern; no denormalized field / backfill needed).
    .searchIndex("search_assetTag", { searchField: "assetTag", filterFields: ["organizationId", "isActive", "isPrep"] }),

  // KitSerializedItem
  kitSerializedItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    assetId: v.string(),
    position: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId", ["kitId"])
    .index("by_assetId", ["assetId"])
    .index("by_addedById", ["addedById"])
    .index("by_organizationId_assetId", ["organizationId", "assetId"]),

  // KitBulkItem
  kitBulkItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    position: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId", ["kitId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_addedById", ["addedById"]),

  // Asset
  assets: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_supplierId", ["supplierId"])
    .index("by_supplierOrderId", ["supplierOrderId"])
    .index("by_locationId", ["locationId"])
    .index("by_kitId", ["kitId"])
    .index("by_parentAssetId", ["parentAssetId"])
    .index("by_organizationId_assetTag", ["organizationId", "assetTag"])
    .index("by_status", ["status"])
    .index("by_isActive", ["isActive"]),
  // (No asset search index: the tag+serial search + its `convex/search.ts` query were
  // removed 2026-07-07 — every asset picker is a multi-select builder/table whose
  // chips need per-id label resolution, not a single-select combobox. Re-add both
  // alongside a real consumer.)

  // BulkAsset
  bulkAssets: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    totalQuantity: v.optional(v.number()),
    availableQuantity: v.optional(v.number()),
    purchasePricePerUnit: v.optional(v.number()),
    locationId: v.optional(v.string()),
    status: v.optional(enums.BulkAssetStatus),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    // WS3 (#942) — minimal pre-WS11 stub, SUPERSEDED by `models.saleStockQuantity`
    // (WS11 #950): the sale-stock spec decision is a single PER-MODEL pool
    // ("we sell *a* SM58, not *our* SM58"), independent of any one bulk-asset
    // row, so the Overbookings & Gaps board's "Sale stock to procure" section
    // now reads `models.saleStockQuantity` instead (see
    // `convex/lib/overbookingBoard.ts` computeSaleStockToProcure). Left in the
    // schema (unused, always undefined in practice) rather than dropped — no
    // writer ever populated it, so there is nothing to migrate.
    saleStockQuantity: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_locationId", ["locationId"])
    .index("by_organizationId_assetTag", ["organizationId", "assetTag"])
    .index("by_status", ["status"])
    .index("by_isActive", ["isActive"]),

  // AssetBulkChild
  assetBulkChildren: defineTable({
    id: v.string(),
    organizationId: v.string(),
    parentAssetId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    allocationMode: v.optional(enums.AccessoryAllocationMode),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_parentAssetId", ["parentAssetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_addedById", ["addedById"]),

  // ModelBulkAccessory
  modelBulkAccessories: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    // Absent = DEFAULT (zero-migration back-compat, issue #794).
    inclusion: v.optional(enums.AccessoryInclusion),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_addedById", ["addedById"])
    .index("by_modelId_bulkAssetId", ["modelId", "bulkAssetId"]),

  // Location
  locations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_parentId", ["parentId"]),

  // MaintenanceRecord
  maintenanceRecords: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    // Incident-report fields (FEATUREDOCS/64) — set only on records created via the
    // "Report Issue" flow or an immediate check-item FAIL; absent on ordinary
    // manually-created maintenance records. lineItemId links back to the specific
    // ProjectLineItem the issue was reported against, when there was one.
    incidentType: v.optional(enums.IncidentType),
    incidentSeverity: v.optional(enums.IncidentSeverity),
    lineItemId: v.optional(v.string()),
    // WS6 #945 — recurring preventative maintenance. Absent on every pre-existing
    // row (ad-hoc REPAIR/INSPECTION/etc. records, and the dead-end nextDueDate
    // above) = not schedule-generated (zero-migration, back-compat).
    // `serviceScheduleId` links a generated cycle back to its `serviceSchedules`
    // row; `poolQuantitySnapshot` freezes the pool denominator (unit count for
    // SERIALIZED, summed totalQuantity for BULK) AT GENERATION TIME, so "18 of
    // 120" stays stable even if the model's fleet is resized mid-cycle.
    serviceScheduleId: v.optional(v.string()),
    poolQuantitySnapshot: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId", ["kitId"])
    .index("by_projectId", ["projectId"])
    .index("by_reportedById", ["reportedById"])
    .index("by_assignedToId", ["assignedToId"])
    .index("by_status", ["status"])
    .index("by_scheduledDate", ["scheduledDate"])
    .index("by_lineItemId", ["lineItemId"])
    // Range-scan an org's OPEN maintenance whose scheduledDate has arrived
    // (dashboardStats.maintenanceDue) — bounds the reactive read-set to the due
    // records instead of collecting the whole org's maintenance table.
    .index("by_organizationId_status_scheduledDate", ["organizationId", "status", "scheduledDate"])
    // WS6 #945: find a schedule's existing cycles (merge semantics — "is there
    // already an open cycle for this schedule?") and the idempotency lookup for
    // a specific (schedule, dueDate) pair, without a whole-org scan.
    .index("by_serviceScheduleId", ["serviceScheduleId"])
    .index("by_serviceScheduleId_scheduledDate", ["serviceScheduleId", "scheduledDate"]),

  // ServiceSchedule (WS6 #945) — fixed-calendar recurring preventative-maintenance
  // cadence for a model (issue #936 tracking issue's Tier-2 "recurring PM,
  // non-blocking" decision). Convex-native — no Prisma equivalent; superseded
  // `models.maintenanceIntervalDays` (a one-time migrate backfill seeds one
  // schedule per model that had it — see backfillMaintenanceSchedules.ts).
  // Cadence is INTERVAL + ANCHOR, not "N days after last service": the whole
  // pool comes due together on a fixed calendar cycle and late completion does
  // NOT shift the next due date (see convex/lib/serviceScheduleCore.ts).
  serviceSchedules: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    name: v.string(),
    intervalMonths: v.number(),
    anchorDate: v.number(), // epoch ms — the first/reference due date
    instructions: v.optional(v.string()),
    isActive: v.optional(v.boolean()), // absent = active (default true, zero-migration)
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_organizationId_modelId", ["organizationId", "modelId"]),

  // MaintenanceRecordAsset — polymorphic (WS6 #945, checkRecords-pattern extension).
  // Two row KINDS share this table (discriminated by `kind`, absent = "LINK" for
  // zero-migration back-compat with every pre-existing row):
  //   • "LINK" (default/legacy) — the ORIGINAL meaning: this asset is linked to
  //     the maintenance record for the hold/release state machine
  //     (maintenanceWrites.ts). `assetId` is always set.
  //   • "CHECKOFF" — a WS6 recurring-PM progress row, NEVER touched by the
  //     hold/release machinery (maintenanceWrites.ts filters these out — see the
  //     `isLinkRow` helper there). Append-only + auditable, checkRecords-style:
  //       - serialised unit done:  { assetId, completedAt, completedById }
  //       - bulk session:          { bulkAssetId, quantity, completedAt, completedById }
  //     "Check all remaining" is one session row for the outstanding quantity.
  // Keeping both kinds in one table (rather than a new table) mirrors the
  // checkRecords polymorphic shape the spec calls out; the `kind` discriminator
  // is what keeps the two meanings from colliding when a PM record is later
  // edited through the ordinary maintenance form (which only ever touches LINK
  // rows).
  maintenanceRecordAssets: defineTable({
    id: v.string(),
    maintenanceRecordId: v.string(),
    assetId: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("LINK"), v.literal("CHECKOFF"))),
    bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    completedById: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_maintenanceRecordId", ["maintenanceRecordId"])
    .index("by_assetId", ["assetId"])
    .index("by_maintenanceRecordId_assetId", ["maintenanceRecordId", "assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"]),

  // Client
  clients: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.optional(enums.ClientType),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingLatitude: v.optional(v.number()),
    billingLongitude: v.optional(v.number()),
    shippingAddress: v.optional(v.string()),
    shippingLatitude: v.optional(v.number()),
    shippingLongitude: v.optional(v.number()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultDiscount: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    // WS1 (#940) — client payment profile drives invoice generation ("deposit not
    // yet invoiced" nudge chips): FULL_UPFRONT (one FULL invoice) or DEPOSIT_BALANCE
    // (a DEPOSIT invoice up front, a BALANCE invoice later). `profileDepositPercent`
    // is % of the tax-INCLUSIVE project total; absent = the org-wide 25% default
    // (see src/lib/validations/client.ts). Absent `paymentProfile` = FULL_UPFRONT.
    paymentProfile: v.optional(enums.ClientPaymentProfile),
    profileDepositPercent: v.optional(v.number()),
    // Xero contact mapping (Xero-linked orgs only) — set by the client-detail
    // "Xero contact" card, or auto-created + stored back on first invoice push if
    // unmapped (see src/server/xero.ts pushInvoiceToXero). `xeroContactName` is a
    // display snapshot (avoids a live Xero call just to show the linked name).
    xeroContactId: v.optional(v.string()),
    xeroContactName: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_isActive", ["isActive"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId", "isActive"] }),

  // ClientContact (WS9 #948 — multiple contacts per client, expand phase).
  // DIRECT (carries organizationId). Child table for `clients` — a client with zero
  // contacts stays valid; the embedded clients.contactName/Email/Phone fields stay
  // live as read-only legacy during the migration window (see FEATUREDOCS/63).
  // `isPrimary`: exclusive-per-client, "absent = false" (mirrors mediaWrites.ts's
  // setPrimaryNative pattern). Cap of 50 contacts/client enforced in the write layer.
  clientContacts: defineTable({
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_clientId", ["clientId"]),

  // Project
  projects: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    // Per-project contact picker (WS9 #948) — defaults to the client's primary
    // contact when unset. Org + belongs-to-project's-client validated on write
    // (projectWrites.ts); cleared when the project's clientId changes.
    clientContactId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    // WS2 (#941) — the two-window date model. `projectStartDate`/`projectEndDate`
    // are the "gear committed" window availability/conflicts read; they default to
    // the rental window at READ TIME via `getProjectWindow` (src/lib/project-window.ts
    // + convex/lib/projectWindow.ts) — NOT stored duplication (R-3.1). loadIn/loadOut
    // and event* are DEPRECATED (kept for one rollout cycle — see FEATUREDOCS/10):
    // loadInDate/Time → projectStartDate/Time, loadOutDate/Time → projectEndDate/Time
    // is the intended replacement; eventStartDate/eventEndDate have no replacement
    // (dropped, not migrated). Do not add new writers of the deprecated fields.
    projectStartDate: v.optional(v.number()),
    projectStartTime: v.optional(v.string()),
    projectEndDate: v.optional(v.number()),
    projectEndTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    // Derived billing weeks/days (#943) — the project-level "billed as N wk M d"
    // summary is DERIVED from rentalStartDate/rentalEndDate via
    // convex/lib/billingDerivation.ts `deriveBillingSummary`, never persisted.
    // These are ONLY the manual override + "edited" marker: absent = derived,
    // present = user-entered override. Replaces the retired
    // defaultRentalPeriod/defaultRentalQuantity + RentalPeriod enum (dead since
    // migration 20260617000000 — see FEATUREDOCS/10).
    billingWeeksOverride: v.optional(v.number()),
    billingDaysOverride: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    // WS11 (#950) — additive revenue/COGS buckets for SALE lines. `subtotal` =
    // equipmentRevenue + serviceRevenue + saleRevenue (convex/lib/recalc.ts).
    // `saleCostTotal` is the resolved COGS chain (asset.purchasePrice ->
    // model.defaultPurchasePrice -> bulkAsset.purchasePricePerUnit ->
    // model.replacementCost) so sale margin is visible in the P&L panel
    // (convex/projectCosts.ts) the same way service/labour/sub-hire costs are.
    saleRevenue: v.optional(v.number()),
    saleCostTotal: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    // #940 (WS1 — finance model) landed: deposit % now lives on the CLIENT payment
    // profile (clients.paymentProfile/profileDepositPercent), not the project — a
    // project has no independent deposit rate, it inherits its client's. depositPaid/
    // invoicedTotal are DERIVED, recalc-owned money anchors (see convex/lib/recalc.ts
    // deriveInvoiceTotals) — summed from this project's non-VOID invoices, same as
    // equipmentRevenue/subtotal/total above. Never client-writable (stripped in
    // projectWrites.ts's PROJECT_MONEY_ANCHORS the same way the others are).
    //
    // DEPRECATED, kept for one rollout cycle (same pattern as loadInDate/eventStartDate
    // above): #940's original removal of this field from the validator broke the prod
    // deploy — real hand-typed wizard values (project-wizard.tsx, pre-#940) are still
    // stored on live project documents, and Convex schema validation rejects a push
    // where an existing document has a field the validator no longer declares. Re-added
    // as optional so it round-trips harmlessly; nothing reads or writes it anymore.
    // `backfillStripProjectDepositPercent.ts` strips it from every project so this can
    // be fully deleted from the validator in a follow-up once that's run and confirmed.
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    // #986 — THE revision counter for this project. Project v2 == Quote v2 ==
    // the projectSnapshots row taken at v2; there is deliberately no second
    // counter anywhere (R-3.1). SERVER-OWNED: written only by createNative
    // (seeded to 1) and quotesWrites.newVersionNative, and stripped from every
    // generic client patch the same way PROJECT_MONEY_ANCHORS are. Optional so
    // pre-#986 documents validate; absent ⇒ 1 via `projectRevision()`
    // (convex/lib/quoteState.ts), and `backfillQuoteRevisions.ts` stamps it.
    revision: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_locationId", ["locationId"])
    .index("by_projectManagerId", ["projectManagerId"])
    .index("by_organizationId_projectNumber", ["organizationId", "projectNumber"])
    .index("by_status", ["status"])
    .index("by_clientId", ["clientId"])
    .index("by_rentalStartDate_rentalEndDate", ["rentalStartDate", "rentalEndDate"])
    // Range-scan an org's projects by rental date (fleet ROI window). A prefix
    // take + filter reads the wrong projects once an org outgrows the cap.
    .index("by_organizationId_rentalStartDate", ["organizationId", "rentalStartDate"])
    // Range-scan an org's overdue projects by rentalEndDate (dashboardStats.
    // overdueReturns) — bounds the reactive read-set to past-end-date projects
    // instead of collecting the whole org's projects table.
    .index("by_organizationId_rentalEndDate", ["organizationId", "rentalEndDate"])
    // WS2 (#941) — range-scan an org's BACKFILLED projectStartDate (the availability
    // candidate scan in convex/overbooking.ts). Only catches projects with
    // projectStartDate explicitly set; the scan pairs this with a rental-index
    // fallback for projects where it's still unset (getProjectWindow's coalesce).
    .index("by_organizationId_projectStartDate", ["organizationId", "projectStartDate"])
    .index("by_isTemplate", ["isTemplate"])
    .index("by_organizationId_status", ["organizationId", "status"]),
  // (No project search index: the app never picks a project in a combobox — projects
  // are created/edited, never selected — so its `convex/search.ts` query was removed
  // 2026-07-07. Re-add both alongside a real single-select project picker.)

  // ProjectLineItem
  projectLineItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: v.optional(enums.LineItemType),
    // WS11 (#950) — set only on `type: "SALE"` lines, never inferred/derived.
    // NEW_STOCK = no rental-asset impact (decrements models.saleStockQuantity).
    // FROM_RENTAL_STOCK = sold out of owned stock (assetId -> AssetStatus
    // "SOLD"; bulkAssetId -> adjustBulkTotal). See convex/lib/saleStock.ts.
    saleMode: v.optional(enums.SaleMode),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    isKitChild: v.optional(v.boolean()),
    childKind: v.optional(enums.LineItemChildKind),
    parentLineItemId: v.optional(v.string()),
    // Durable per-line accessory selection (issue #794) — the parent line's
    // authority for its effective accessory set. Absent = template behaviour
    // (all model DEFAULTs, no OPTIONALs). See resolveLineAccessoryPlan.
    accessoryPlan: v.optional(enums.AccessoryPlanArg),
    // Denormalized copy of the tier ("DEFAULT" | "OPTIONAL") stamped onto an
    // accessory CHILD line at creation time (issue #794 follow-up), so warehouse
    // checkout gating can read the tier straight off the child without
    // cross-referencing the parent's accessoryPlan/model config. Only set on
    // lines with isKitChild + childKind === "ACCESSORY".
    accessoryInclusion: v.optional(enums.AccessoryInclusion),
    pricingMode: v.optional(enums.KitPricingMode),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    allocatedRevenue: v.optional(v.number()),
    allocationBasis: v.optional(enums.AllocationBasis),
    priceBreakdown: v.optional(v.string()),
    priceOverridden: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    groupName: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    notes: v.optional(v.string()),
    isOptional: v.optional(v.boolean()),
    status: v.optional(enums.LineItemStatus),
    checkedOutQuantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    assignedQuantity: v.optional(v.number()),
    packedQuantity: v.optional(v.number()),
    damagedQuantity: v.optional(v.number()),
    lostQuantity: v.optional(v.number()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnNotes: v.optional(v.string()),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    isContainerLineItem: v.optional(v.boolean()),
    isCustomItem: v.optional(v.boolean()),
    returnStatus: v.optional(enums.ReturnStatus),
    showSubhireOnDocs: v.optional(v.boolean()),
    supplierId: v.optional(v.string()),
    subhireOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    subHireId: v.optional(v.string()),
    subHireItemId: v.optional(v.string()),
    subHireGroupId: v.optional(v.string()),
    // WS1 (#940) — Xero account-coding cascade, level 1 (per-line override — wins
    // over model/kit/category/org-default) + per-line tax-type override. Both
    // Xero-gated in the UI (line edit dialog's collapsed "Xero coding" section) and
    // resolved server-side at invoice-push time, snapshotted onto invoiceLines (an
    // issued invoice's coding never changes retroactively). See
    // convex/lib/xeroAccountCascade.ts.
    xeroAccountCode: v.optional(v.string()),
    xeroTaxType: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    // Composite: max(sortOrder) for a project via .order("desc").first() (1 doc)
    // instead of collecting ALL of a project's lines to reduce the max (O(N) per
    // add, O(N^2) across a bulk add). Used by nextLineSort.
    .index("by_projectId_sortOrder", ["projectId", "sortOrder"])
    // Composite: range-scan a project's lines by status (e.g. CHECKED_OUT) instead
    // of collecting ALL of a project's lines and JS-filtering. Used by
    // warehouseOps.checkInBulkTotals (the hottest status-filtered read).
    .index("by_projectId_status", ["projectId", "status"])
    // Composite: range-scan an org's CHECKED_OUT lines ORG-WIDE (no project
    // pre-selection) instead of collecting the whole org's lines and JS-filtering.
    // Used by warehouseReturns.bundle (WS5 returns station board, issue #944) —
    // capped read, see docs/exceptions.md R-9.8 (returns-board-orgwide-checkedout).
    .index("by_organizationId_status", ["organizationId", "status"])
    .index("by_modelId", ["modelId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_kitId", ["kitId"])
    .index("by_parentLineItemId", ["parentLineItemId"])
    .index("by_categoryId", ["categoryId"])
    .index("by_groupId", ["groupId"])
    .index("by_checkedOutById", ["checkedOutById"])
    .index("by_returnedById", ["returnedById"])
    .index("by_supplierId", ["supplierId"])
    .index("by_supplierOrderId", ["supplierOrderId"])
    .index("by_subHireId", ["subHireId"])
    .index("by_subHireItemId", ["subHireItemId"])
    .index("by_subHireGroupId", ["subHireGroupId"])
    // Composite: range-scan an org's flagged lines (FLAGGED_FAULTY /
    // FLAGGED_TT_OVERDUE) by prepStatus instead of collecting the whole org
    // (perf-convex-efficiency-2026-06.md Finding #0b). Used by the notification
    // digest's flagged-asset scan.
    .index("by_organizationId_prepStatus", ["organizationId", "prepStatus"]),

  // ProjectLineItemUnit
  projectLineItemUnits: defineTable({
    id: v.string(),
    organizationId: v.string(),
    lineItemId: v.string(),
    ordinal: v.number(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    parentUnitAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    status: v.optional(enums.LineItemStatus),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnStatus: v.optional(enums.ReturnStatus),
    returnNotes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_lineItemId", ["lineItemId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_lineItemId_assetId", ["lineItemId", "assetId"])
    .index("by_lineItemId_ordinal", ["lineItemId", "ordinal"])
    .index("by_organizationId_assetId_status", ["organizationId", "assetId", "status"])
    .index("by_organizationId_bulkAssetId_status", ["organizationId", "bulkAssetId", "status"])
    .index("by_lineItemId_status", ["lineItemId", "status"]),

  // LineItemMergeMap
  lineItemMergeMaps: defineTable({
    id: v.string(),
    organizationId: v.string(),
    oldLineItemId: v.string(),
    canonicalLineItemId: v.string(),
    movedUnitId: v.optional(v.string()),
    checkRecordsRepointed: v.optional(v.number()),
    serviceRepointed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    mergedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_oldLineItemId", ["oldLineItemId"])
    .index("by_canonicalLineItemId", ["canonicalLineItemId"]),

  // ProjectCategory
  projectCategories: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"]),

  // CategorySlot
  categorySlots: defineTable({
    id: v.string(),
    projectCategoryId: v.string(),
    sortOrder: v.number(),
    projectGroupId: v.optional(v.string()),
    subHireGroupId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_projectCategoryId", ["projectCategoryId"])
    .index("by_projectGroupId", ["projectGroupId"])
    .index("by_subHireGroupId", ["subHireGroupId"])
    .index("by_projectCategoryId_sortOrder", ["projectCategoryId", "sortOrder"]),

  // ProjectGroup
  projectGroups: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    categoryId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    price: v.optional(v.number()),
    // Flat $ amount off `price × quantity` (#883) — mirrors projectLineItems.discount.
    discount: v.optional(v.number()),
    suggestedPrice: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    // WS1 (#940) — Xero account-coding override for a priced group's own
    // invoice line (convex/lib/financeSnapshot.ts's "priced groups bill as
    // ONE line"). Cascade: this override -> categoryId's category default ->
    // org default (convex/xeroPush.ts resolveGroupLineCode) -- a group isn't
    // a model/kit, so it has no level-2 equivalent in the cascade.
    xeroAccountCode: v.optional(v.string()),
    xeroTaxType: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_categoryId", ["categoryId"]),

  // ProjectManager
  projectManagers: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    addedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_userId", ["userId"])
    .index("by_projectId_userId", ["projectId", "userId"]),

  // KitRevenueAllocation — one row per MODEL in a kit (not per member asset).
  kitRevenueAllocations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    modelId: v.string(),
    allocationPercent: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId_modelId", ["kitId", "modelId"])
    .index("by_kitId", ["kitId"])
    .index("by_modelId", ["modelId"]),

  // ProjectModelRevenue — derived rollup, rebuilt by the allocation pass. Pure
  // cache: safe to delete and rebuild from projectLineItems at any time.
  projectModelRevenues: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    modelId: v.string(),
    allocatedRevenue: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId_modelId", ["projectId", "modelId"])
    .index("by_projectId", ["projectId"])
    .index("by_modelId", ["modelId"])
    .index("by_organizationId_modelId", ["organizationId", "modelId"]),

  // GroupTemplate
  groupTemplates: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // GroupTemplateItem
  groupTemplateItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    templateId: v.string(),
    modelId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_templateId", ["templateId"])
    .index("by_modelId", ["modelId"])
    .index("by_kitId", ["kitId"]),

  // AssetScanLog
  assetScanLogs: defineTable({
    id: v.string(),
    organizationId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    action: enums.ScanAction,
    scannedById: v.string(),
    scannedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    location: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_kitId", ["kitId"])
    .index("by_projectId", ["projectId"])
    .index("by_scannedById", ["scannedById"])
    .index("by_scannedAt", ["scannedAt"])
    .index("by_organizationId_scannedAt", ["organizationId", "scannedAt"]),

  // FileUpload
  fileUploads: defineTable({
    id: v.string(),
    organizationId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    storageKey: v.string(),
    url: v.string(),
    thumbnailUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploadedById: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_uploadedById", ["uploadedById"])
    // Point-lookup a fileUpload by its thumbnailUrl instead of scanning the whole
    // (cross-org) table. Used by getByThumbnailUrl.
    .index("by_thumbnailUrl", ["thumbnailUrl"]),

  // ModelMedia
  modelMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_fileId", ["fileId"])
    .index("by_modelId_fileId", ["modelId", "fileId"]),

  // AssetMedia
  assetMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    assetId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_assetId", ["assetId"])
    .index("by_fileId", ["fileId"])
    .index("by_assetId_fileId", ["assetId", "fileId"])
    // Hand-added (not emitted by the CRUD generator, R-9.8/#901): narrows
    // registryPhotos' org-wide primary-photo scan to just the isPrimary rows —
    // `isPrimary` is a plain boolean (no "default when absent" semantics, unlike
    // status/date fields elsewhere), so an exact-match index is safe here.
    .index("by_organizationId_isPrimary", ["organizationId", "isPrimary"]),

  // KitMedia
  kitMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId", ["kitId"])
    .index("by_fileId", ["fileId"])
    .index("by_kitId_fileId", ["kitId", "fileId"]),

  // ProjectMedia
  projectMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.ProjectMediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_fileId", ["fileId"])
    .index("by_projectId_fileId", ["projectId", "fileId"]),

  // ClientMedia
  clientMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_fileId", ["fileId"])
    .index("by_clientId_fileId", ["clientId", "fileId"])
    .index("by_clientId", ["clientId"]),

  // LocationMedia
  locationMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    locationId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_locationId", ["locationId"])
    .index("by_fileId", ["fileId"])
    .index("by_locationId_fileId", ["locationId", "fileId"]),

  // SubHireMedia
  subHireMedia: defineTable({
    id: v.string(),
    organizationId: v.string(),
    subHireId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_subHireId", ["subHireId"])
    .index("by_fileId", ["fileId"])
    .index("by_subHireId_fileId", ["subHireId", "fileId"]),

  // TestProfile
  testProfiles: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    visualChecks: v.any(),
    electricalTests: v.any(),
    thresholds: v.any(),
    requiresSubTests: v.optional(v.boolean()),
    defaultSubTestCount: v.optional(v.number()),
    subTestLabel: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_name", ["organizationId", "name"])
    .index("by_organizationId_isActive", ["organizationId", "isActive"])
    .index("by_organizationId_equipmentClass_applianceType", ["organizationId", "equipmentClass", "applianceType"]),

  // TestTagAsset
  testTagAssets: defineTable({
    id: v.string(),
    organizationId: v.string(),
    testTagId: v.string(),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    status: v.optional(enums.TestTagStatus),
    lastTestDate: v.optional(v.number()),
    nextDueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_testProfileId", ["testProfileId"])
    .index("by_organizationId_testTagId", ["organizationId", "testTagId"])
    .index("by_organizationId_status", ["organizationId", "status"])
    .index("by_organizationId_nextDueDate", ["organizationId", "nextDueDate"])
    .index("by_organizationId_assetId", ["organizationId", "assetId"])
    .index("by_organizationId_bulkAssetId", ["organizationId", "bulkAssetId"]),

  // TestTagRecord
  testTagRecords: defineTable({
    id: v.string(),
    organizationId: v.string(),
    testTagAssetId: v.string(),
    testProfileId: v.optional(v.string()),
    testDate: v.number(),
    testedById: v.string(),
    testerName: v.string(),
    result: v.optional(enums.TestResult),
    visualInspectionResult: v.optional(enums.TestResult),
    visualCordCondition: v.optional(v.boolean()),
    visualPlugCondition: v.optional(v.boolean()),
    visualHousingCondition: v.optional(v.boolean()),
    visualSwitchCondition: v.optional(v.boolean()),
    visualVentsUnobstructed: v.optional(v.boolean()),
    visualCordGrip: v.optional(v.boolean()),
    visualEarthPin: v.optional(v.boolean()),
    visualMarkingsLegible: v.optional(v.boolean()),
    visualNoModifications: v.optional(v.boolean()),
    visualNotes: v.optional(v.string()),
    equipmentClassTested: v.optional(enums.EquipmentClass),
    testMethod: v.optional(enums.TestMethod),
    earthContinuityResult: v.optional(enums.TestResult),
    earthContinuityReading: v.optional(v.number()),
    insulationResult: v.optional(enums.TestResult),
    insulationReading: v.optional(v.number()),
    insulationTestVoltage: v.optional(v.number()),
    leakageCurrentResult: v.optional(enums.TestResult),
    leakageCurrentReading: v.optional(v.number()),
    polarityResult: v.optional(enums.TestResult),
    rcdTripTimeResult: v.optional(enums.TestResult),
    rcdTripTimeReading: v.optional(v.number()),
    functionalTestResult: v.optional(enums.TestResult),
    functionalTestNotes: v.optional(v.string()),
    failureAction: v.optional(enums.FailureAction),
    failureNotes: v.optional(v.string()),
    nextDueDate: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_testTagAssetId", ["testTagAssetId"])
    .index("by_testProfileId", ["testProfileId"])
    .index("by_testedById", ["testedById"])
    .index("by_organizationId_testTagAssetId", ["organizationId", "testTagAssetId"])
    .index("by_organizationId_testDate", ["organizationId", "testDate"]),

  // SubTestRecord
  subTestRecords: defineTable({
    id: v.string(),
    testTagRecordId: v.string(),
    label: v.string(),
    sortOrder: v.optional(v.number()),
    result: v.optional(enums.TestResult),
    earthContinuityResult: v.optional(enums.TestResult),
    earthContinuityReading: v.optional(v.number()),
    insulationResult: v.optional(enums.TestResult),
    insulationReading: v.optional(v.number()),
    leakageCurrentResult: v.optional(enums.TestResult),
    leakageCurrentReading: v.optional(v.number()),
    polarityResult: v.optional(enums.TestResult),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_testTagRecordId", ["testTagRecordId"])
    .index("by_testTagRecordId_sortOrder", ["testTagRecordId", "sortOrder"]),

  // TwoFactor
  twoFactors: defineTable({
    id: v.string(),
    secret: v.string(),
    backupCodes: v.string(),
    userId: v.string(),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"]),

  // BackupCode
  backupCodes: defineTable({
    id: v.string(),
    code: v.string(),
    used: v.optional(v.boolean()),
    userId: v.string(),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"]),

  // Passkey
  passkeys: defineTable({
    id: v.string(),
    name: v.optional(v.string()),
    publicKey: v.string(),
    userId: v.string(),
    credentialID: v.string(),
    counter: v.number(),
    deviceType: v.string(),
    backedUp: v.boolean(),
    transports: v.optional(v.string()),
    aaguid: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"])
    .index("by_credentialID", ["credentialID"]),

  // SystemFlags — a platform-global SINGLETON emergency brake for the
  // browser-direct mutation surface (Phase 3). `writesDisabled` (or a domain in
  // `disabledDomains`) makes `assertWritesEnabled` (convex/lib/writeGuard.ts) throw,
  // so a runaway/abusive client can be cut off instantly without a redeploy. Read
  // inline by the guard; flipped by the SERVICE-gated `systemFlags.setWrites`.
  systemFlags: defineTable({
    writesDisabled: v.optional(v.boolean()),
    disabledReason: v.optional(v.string()),
    disabledDomains: v.optional(v.array(v.string())),
    updatedAt: v.optional(v.number()),
  }),

  // OrgSettings — per-org BUSINESS settings, migrated OFF the Better Auth
  // `organizations` row (Phase 1 source-of-truth inversion). The `settings`
  // field is the JSON blob that used to live in `organization.metadata`
  // (OrgSettings TS shape: branding, testTag, sso, asset-tag + project-number
  // config, ical, currency/tax labels, …). Three fields are denormalised out of
  // the blob for indexed / standalone reads:
  //   - defaultTaxRate  — read standalone by line-item tax resolution
  //   - apiKillSwitchAt — the API kill-switch timestamp (ms)
  //   - icalToken       — SET ONLY WHILE the feed is ENABLED, so a by_icalToken
  //                       hit means "valid + live" without parsing the blob.
  // One row per org (by_organizationId). See FEATUREDOCS/54.
  orgSettings: defineTable({
    organizationId: v.string(),
    settings: v.optional(v.string()), // JSON string of the OrgSettings blob
    defaultTaxRate: v.optional(v.number()),
    apiKillSwitchAt: v.optional(v.number()),
    icalToken: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_icalToken", ["icalToken"]),

  // SiteSettings
  siteSettings: defineTable({
    id: v.string(),
    platformName: v.optional(v.string()),
    platformIcon: v.optional(v.string()),
    platformLogo: v.optional(v.string()),
    registrationPolicy: v.optional(v.string()),
    twoFactorGlobalPolicy: v.optional(v.string()),
    defaultCurrency: v.optional(v.string()),
    defaultTaxRate: v.optional(v.number()),
    allowOrgCreation: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"]),

  // ActivityLog
  activityLogs: defineTable({
    id: v.string(),
    organizationId: v.string(),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    entityName: v.string(),
    userId: v.optional(v.string()),
    userName: v.string(),
    summary: v.string(),
    details: v.optional(v.any()),
    metadata: v.optional(v.any()),
    projectId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_organizationId_createdAt", ["organizationId", "createdAt"])
    .index("by_organizationId_entityType", ["organizationId", "entityType"])
    .index("by_organizationId_userId", ["organizationId", "userId"])
    .index("by_organizationId_projectId", ["organizationId", "projectId"])
    .index("by_organizationId_assetId", ["organizationId", "assetId"])
    .index("by_organizationId_entityType_entityId", ["organizationId", "entityType", "entityId"]),

  // CrewMember
  crewMembers: defineTable({
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    // Phase C: the member↔skill m2m (_CrewMemberToCrewSkill, never mutated in-app)
    // is represented as a skillId array on the member doc (backfilled from Prisma).
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_crewRoleId", ["crewRoleId"])
    .index("by_icalToken", ["icalToken"])
    .index("by_organizationId_email", ["organizationId", "email"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // CrewRole
  crewRoles: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    department: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultRate: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    // Client-facing charge rate for this role (WS10 #949) — same `rateType` unit as
    // `defaultRate` (one rateType per role governs both the cost AND charge cascades).
    // null/absent = no auto-pricing for this role (margin hidden, not a fake 0%/-100%).
    chargeRate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_name", ["organizationId", "name"]),

  // CrewSkill
  crewSkills: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    category: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_name", ["organizationId", "name"]),

  // CrewAssignment
  crewAssignments: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    isProjectManager: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    responseToken: v.optional(v.string()),
    offeredAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    responseNote: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    confirmedById: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_crewMemberId", ["crewMemberId"])
    .index("by_crewRoleId", ["crewRoleId"])
    .index("by_confirmedById", ["confirmedById"])
    .index("by_serviceId", ["serviceId"])
    .index("by_responseToken", ["responseToken"])
    .index("by_crewMemberId_startDate", ["crewMemberId", "startDate"])
    .index("by_crewMemberId_startDate_endDate", ["crewMemberId", "startDate", "endDate"])
    .index("by_organizationId_status", ["organizationId", "status"])
    // WS3 (#942) — range-scan an org's assignments by `startDate` for the
    // Overbookings & Gaps board's "unconfirmed crew" section (bounded
    // [MIN_TS, rangeEnd] scan). The existing `by_crewMemberId_startDate*`
    // indexes are member-scoped only; this is the org-wide equivalent R-9.8 needs.
    .index("by_organizationId_startDate", ["organizationId", "startDate"]),

  // CrewShift
  crewShifts: defineTable({
    id: v.string(),
    assignmentId: v.string(),
    date: v.number(),
    callTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    breakMinutes: v.optional(v.number()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(enums.ShiftStatus),
  })
    .index("by_cuid", ["id"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_assignmentId_date", ["assignmentId", "date"]),

  // CrewAvailability
  crewAvailabilities: defineTable({
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_crewMemberId", ["crewMemberId"])
    .index("by_crewMemberId_startDate_endDate", ["crewMemberId", "startDate", "endDate"])
    .index("by_organizationId", ["organizationId"]),

  // CrewTimeEntry
  crewTimeEntries: defineTable({
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_crewMemberId", ["crewMemberId"])
    .index("by_approvedById", ["approvedById"])
    .index("by_crewMemberId_date", ["crewMemberId", "date"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // ProjectService
  projectServices: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.optional(v.number()),
    endDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    estimatedDuration: v.optional(v.number()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    status: v.optional(enums.ServiceStatus),
    showOnDocuments: v.optional(v.boolean()),
    billableToClient: v.optional(v.boolean()),
    unitPrice: v.optional(v.number()),
    quantity: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    // Charge-side auto-pricing (WS10 #949). `chargeRateOverride` overrides the PER-
    // ASSIGNMENT charge-rate cascade for this service's crew (cascade:
    // chargeRateOverride -> role.chargeRate -> null); `crewChargeTotal` is the
    // resulting sum (convex/lib/serviceCost.ts recalcServiceChargeFromCrew), the
    // charge-side twin of `costTotal`. Deliberately NOT named `chargeTotal` — that
    // name is already used (project-service-read.ts / project-services.ts) for the
    // AGGREGATE "sum of lineTotal across services" concept, a different quantity
    // (post-discount, post-manual-override) than this pre-discount per-service input.
    chargeRateOverride: v.optional(v.number()),
    crewChargeTotal: v.optional(v.number()),
    taxable: v.optional(v.boolean()),
    lineItemId: v.optional(v.string()),
    vehicleDescription: v.optional(v.string()),
    numberOfTrips: v.optional(v.number()),
    crewCountRequired: v.optional(v.number()),
    crewRoleId: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    // WS1 (#940) — Xero account-coding for services. `xeroAccountCode` overrides the
    // per-service-type org default (labour / delivery-transport / misc — integration
    // settings mapping); `xeroTaxType` mirrors the line-level tax override. Both
    // Xero-gated. See convex/lib/xeroAccountCascade.ts resolveServiceAccountCode.
    xeroAccountCode: v.optional(v.string()),
    xeroTaxType: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_lineItemId", ["lineItemId"])
    .index("by_crewRoleId", ["crewRoleId"])
    .index("by_projectId_type", ["projectId", "type"])
    .index("by_projectId_date", ["projectId", "date"])
    // WS3 (#942) — range-scan an org's services by `date` for the Overbookings &
    // Gaps board's "services missing crew" section (bounded [MIN_TS, rangeEnd]
    // scan, the dashboardStats.ts MIN_TS idiom). `by_projectId_date` only serves a
    // single-project scan; this is the org-wide equivalent R-9.8 needs.
    .index("by_organizationId_date", ["organizationId", "date"]),

  // Quote revision (WS1 #940, reworked by #986). ONE row per
  // `(projectId, projects.revision)` — `version` IS the revision the row was cut
  // from, never an independent counter. `snapshot` is a JSON blob (lines +
  // totals) frozen at SEND time; `snapshotId` points at the `projectSnapshots`
  // row capturing the whole entity state for the same revision.
  //
  // State machine (convex/quotesWrites.ts): DRAFT ─send→ SENT ─accept→ ACCEPTED,
  // ─decline→ DECLINED, ─recall→ DRAFT; the previous SENT/ACCEPTED row flips to
  // SUPERSEDED only when the NEXT revision actually sends (never on draft), so
  // there is always exactly one row representing "what the client currently
  // has". EXPIRED is DERIVED on read (validUntil < now && SENT) — never stored,
  // no cron, no clock skew (convex/lib/quoteState.ts).
  //
  // `publishedAt`/`publishedById` are the DEPRECATED pre-#986 names, kept
  // declared until `backfillQuoteRevisions.ts` confirms zero remaining rows
  // carry them (schema-validation precedent: FEATUREDOCS/66 `depositPercent`).
  // `pdfFileId` links the stored immutable artifact — written in Phase B (#987).
  quotes: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    version: v.number(),
    status: enums.QuoteStatus,
    snapshot: v.any(),
    pdfFileId: v.optional(v.string()),
    snapshotId: v.optional(v.string()),
    // Send (the freeze moment)
    quoteDate: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    validityDays: v.optional(v.number()),
    recipientContactId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    sentById: v.optional(v.string()),
    // Outcome
    acceptedAt: v.optional(v.number()),
    acceptedById: v.optional(v.string()),
    acceptanceRef: v.optional(v.string()),
    declinedAt: v.optional(v.number()),
    declinedById: v.optional(v.string()),
    declineReason: v.optional(v.string()),
    // Recall (un-send; the artifact is retained, never deleted)
    recalledAt: v.optional(v.number()),
    recalledById: v.optional(v.string()),
    recallReason: v.optional(v.string()),
    supersededByQuoteId: v.optional(v.string()),
    // DEPRECATED (pre-#986) — backfilled into sentAt/sentById.
    publishedAt: v.optional(v.number()),
    publishedById: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    // The uniqueness guard for "exactly one quote row per (projectId, revision)".
    .index("by_projectId_version", ["projectId", "version"])
    .index("by_projectId_status", ["projectId", "status"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // Invoice (WS1 #940) — Flow owns generation + numbering, Xero owns the ledger.
  // `invoiceNumber` is null until ISSUED (numbered at issue time via the shared
  // projectNumberSequences engine, namespaced scopeKey "INV:<period>" — see
  // convex/invoicesWrites.ts issueNative). Immutable once ISSUED: edits are a VOID
  // + reissue, or a CREDIT invoice — never an in-place patch of issued amounts.
  // `paymentStatus` mirrors SubHirePaymentStatus's vocabulary and is written ONLY
  // by the Xero payment-status poll (phase 2), never by the client.
  invoices: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    clientId: v.string(),
    kind: enums.InvoiceKind,
    status: enums.InvoiceStatus,
    paymentStatus: v.optional(enums.InvoicePaymentStatus),
    invoiceNumber: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    issuedById: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    // Money snapshot, frozen at create/issue time (never recomputed from live
    // project pricing after issue — R-9.3 "server is the authority", but the
    // authoritative moment is issue, not "whenever read").
    subtotal: v.number(),
    taxAmount: v.number(),
    total: v.number(),
    // % of the tax-inclusive project total this DEPOSIT invoice represents
    // (informational snapshot of the client profile % used at creation time).
    depositPercent: v.optional(v.number()),
    notes: v.optional(v.string()),
    // A CREDIT invoice's back-reference to the invoice it credits.
    creditForInvoiceId: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
    voidedById: v.optional(v.string()),
    voidReason: v.optional(v.string()),
    // Xero push state (src/server/xero.ts pushInvoiceToXero).
    xeroInvoiceId: v.optional(v.string()),
    xeroSyncStatus: v.optional(enums.XeroSyncStatus),
    lastSyncError: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_clientId", ["clientId"])
    .index("by_organizationId_status", ["organizationId", "status"])
    .index("by_organizationId_projectId", ["organizationId", "projectId"])
    // Collision guard for the issue-time numbering allocation (belt-and-braces
    // alongside the serializable counter — mirrors projects.by_organizationId_projectNumber).
    .index("by_organizationId_invoiceNumber", ["organizationId", "invoiceNumber"]),

  // InvoiceLine (WS1 #940) — snapshot rows under an invoice. PARENT_JOIN for
  // org-export purposes (no organizationId column — joined via invoiceId into an
  // already org-scoped `invoices` row, the supplierOrderItems/subHireItems
  // pattern). Carries the RESOLVED xeroAccountCode/xeroTaxType per line (resolved
  // server-side at push time via the cascade in convex/lib/xeroAccountCascade.ts
  // and frozen here — an issued invoice's coding never changes retroactively when
  // a model/kit/category mapping changes later).
  invoiceLines: defineTable({
    id: v.string(),
    invoiceId: v.string(),
    sourceType: enums.InvoiceLineSourceType,
    sourceLineItemId: v.optional(v.string()),
    description: v.string(),
    quantity: v.number(),
    unitPrice: v.number(),
    lineTotal: v.number(),
    xeroAccountCode: v.optional(v.string()),
    xeroTaxType: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_invoiceId", ["invoiceId"]),

  // ServiceTemplate
  serviceTemplates: defineTable({
    id: v.string(),
    organizationId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    defaultCrewCount: v.optional(v.number()),
    defaultVehicle: v.optional(v.string()),
    defaultPricingType: v.optional(enums.PricingType),
    defaultUnitPrice: v.optional(v.number()),
    showOnDocuments: v.optional(v.boolean()),
    isAutoAdded: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // WarehouseDashboardToken
  warehouseDashboardTokens: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    locationId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    layout: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_locationId", ["locationId"])
    .index("by_createdById", ["createdById"])
    .index("by_tokenHash", ["tokenHash"]),

  // TestTagAuditorToken
  testTagAuditorTokens: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdById", ["createdById"])
    .index("by_tokenHash", ["tokenHash"]),

  // WooCommerceIntegration
  wooCommerceIntegrations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    isEnabled: v.optional(v.boolean()),
    webhookSecret: v.optional(v.string()),
    storeUrl: v.optional(v.string()),
    productMatchField: v.optional(v.string()),
    customFieldKey: v.optional(v.string()),
    rentalStartKey: v.optional(v.string()),
    rentalEndKey: v.optional(v.string()),
    eventStartKey: v.optional(v.string()),
    deliveryAddressKey: v.optional(v.string()),
    notesKey: v.optional(v.string()),
    dateFormat: v.optional(v.string()),
    locationMetaKey: v.optional(v.string()),
    defaultLocationId: v.optional(v.string()),
    defaultProjectType: v.optional(v.string()),
    autoConfirmEnquiry: v.optional(v.boolean()),
    notifyUserIds: v.optional(v.array(v.string())),
    lastPayload: v.optional(v.any()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // WooCommerceOrderLog
  wooCommerceOrderLogs: defineTable({
    id: v.string(),
    organizationId: v.string(),
    wooOrderId: v.number(),
    wooOrderNumber: v.optional(v.string()),
    status: enums.WooOrderLogStatus,
    projectId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.any(),
    errorMessage: v.optional(v.string()),
    matchResults: v.optional(v.any()),
    dateExtraction: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_wooOrderId", ["wooOrderId"]),

  // XeroIntegration (WS1 #940) — per-org Xero connection + coding config, one row
  // per org (modeled on wooCommerceIntegrations). `refreshTokenEncrypted` is
  // AES-256-GCM via src/lib/crypto/secret-vault.ts (never stored plain); no access
  // token is persisted — it's minted from the refresh token on demand
  // (src/lib/xero-client.ts). `defaultAccountCode` is cascade level 4 (org
  // default); `serviceAccountDefaults` maps ServiceType -> Xero account code
  // (labour/delivery-transport/misc); `defaultTaxType` maps the org's default GST
  // rate to a Xero TaxType code. `cachedAccounts`/`cachedTaxRates` are the chart of
  // accounts + tax rates fetched on connect and via the settings-page "Refresh"
  // action — pickers read this cache, never Xero directly per keystroke.
  xeroIntegrations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    isConnected: v.optional(v.boolean()),
    tenantId: v.optional(v.string()),
    tenantName: v.optional(v.string()),
    refreshTokenEncrypted: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    connectedById: v.optional(v.string()),
    defaultAccountCode: v.optional(v.string()),
    serviceAccountDefaults: v.optional(v.any()),
    defaultTaxType: v.optional(v.string()),
    cachedAccounts: v.optional(v.any()),
    cachedTaxRates: v.optional(v.any()),
    cacheRefreshedAt: v.optional(v.number()),
    cacheError: v.optional(v.string()),
    lastSyncError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // XeroSyncLog (WS1 #940) — audit log of every Xero API interaction (modeled on
  // wooCommerceOrderLogs). One row per push/contact-sync/token-refresh/reference
  // fetch attempt, success or failure — the operator-visible trail behind a "why
  // didn't this invoice sync" question.
  xeroSyncLogs: defineTable({
    id: v.string(),
    organizationId: v.string(),
    direction: enums.XeroSyncDirection,
    status: enums.XeroSyncLogStatus,
    invoiceId: v.optional(v.string()),
    xeroInvoiceId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_invoiceId", ["invoiceId"]),

  // CheckItem
  checkItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    type: v.optional(enums.CheckItemType),
    category: v.optional(v.string()),
    measurementUnit: v.optional(v.string()),
    measurementMin: v.optional(v.number()),
    measurementMax: v.optional(v.number()),
    dropdownOptions: v.optional(v.any()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdById", ["createdById"])
    .index("by_organizationId_category", ["organizationId", "category"]),

  // ModelCheckItem
  modelCheckItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_checkItemId", ["checkItemId"])
    .index("by_modelId_checkItemId", ["modelId", "checkItemId"])
    .index("by_organizationId_modelId", ["organizationId", "modelId"]),

  // KitCheckItem
  kitCheckItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_kitId", ["kitId"])
    .index("by_checkItemId", ["checkItemId"])
    .index("by_kitId_checkItemId", ["kitId", "checkItemId"])
    .index("by_organizationId_kitId", ["organizationId", "kitId"]),

  // CheckRecord
  checkRecords: defineTable({
    id: v.string(),
    organizationId: v.string(),
    context: enums.CheckContext,
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    checkItemId: v.string(),
    checkItemLabelSnapshot: v.string(),
    checkItemTypeSnapshot: enums.CheckItemType,
    result: enums.CheckResult,
    value: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    performedById: v.string(),
    performedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_lineItemId", ["lineItemId"])
    .index("by_lineItemUnitId", ["lineItemUnitId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_kitId", ["kitId"])
    .index("by_checkItemId", ["checkItemId"])
    .index("by_performedById", ["performedById"])
    .index("by_organizationId_assetId", ["organizationId", "assetId"])
    .index("by_organizationId_checkItemId", ["organizationId", "checkItemId"]),

  // WarehouseClose
  warehouseCloses: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.optional(v.number()),
    storedCount: v.optional(v.number()),
    damagedCount: v.optional(v.number()),
    lostCount: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_closedById", ["closedById"])
    .index("by_projectId_organizationId", ["projectId", "organizationId"]),

  // NotificationDismissal
  notificationDismissals: defineTable({
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_userId_notificationKey", ["userId", "notificationKey"])
    .index("by_organizationId_userId", ["organizationId", "userId"]),

  // UserNotificationPreference
  userNotificationPreferences: defineTable({
    id: v.string(),
    userId: v.string(),
    overdueMaintenance: v.optional(v.boolean()),
    overdueReturn: v.optional(v.boolean()),
    upcomingProject: v.optional(v.boolean()),
    lowStock: v.optional(v.boolean()),
    pendingInvitation: v.optional(v.boolean()),
    expiringCert: v.optional(v.boolean()),
    pendingOffers: v.optional(v.boolean()),
    pendingTimesheets: v.optional(v.boolean()),
    flaggedAsset: v.optional(v.boolean()),
    incidentReport: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_userId", ["userId"]),

  // NotificationEmailLog
  notificationEmailLogs: defineTable({
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    sentAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_userId_notificationKey", ["userId", "notificationKey"])
    .index("by_organizationId_sentAt", ["organizationId", "sentAt"]),

  // Phase 6b — idempotency ledger for Convex-scheduled email side-effects.
  // One row per delivered (or in-flight) email, keyed by a caller-supplied
  // idempotency key. Guards against action-retry double-sends: `emails.claim`
  // does a transactional first-writer-wins insert; a failed send releases the
  // claim so a later attempt can re-send. NOT a general email log — only sends
  // routed through `convex/emailActions.ts` land here.
  sentEmails: defineTable({
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    sentAt: v.number(),
  }).index("by_idempotencyKey", ["idempotencyKey"]),

  // CustomFieldDefinition
  customFieldDefinitions: defineTable({
    id: v.string(),
    organizationId: v.string(),
    entityType: v.optional(enums.CustomFieldEntity),
    label: v.string(),
    fieldKey: v.string(),
    fieldType: v.optional(enums.CustomFieldType),
    options: v.optional(v.array(v.string())),
    required: v.optional(v.boolean()),
    helpText: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_entityType_fieldKey", ["organizationId", "entityType", "fieldKey"])
    .index("by_organizationId_entityType", ["organizationId", "entityType"]),

  // ProjectNumberSequence
  projectNumberSequences: defineTable({
    id: v.string(),
    organizationId: v.string(),
    scopeKey: v.string(),
    value: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_scopeKey", ["organizationId", "scopeKey"]),

  // ProjectTask
  projectTasks: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    checklist: v.optional(v.any()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    createdById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_assigneeUserId", ["assigneeUserId"])
    .index("by_assigneeCrewId", ["assigneeCrewId"])
    .index("by_createdById", ["createdById"])
    .index("by_organizationId_projectId", ["organizationId", "projectId"])
    .index("by_projectId_status", ["projectId", "status"])
    .index("by_assigneeUserId_status", ["assigneeUserId", "status"])
    .index("by_assigneeCrewId_status", ["assigneeCrewId", "status"]),

  // SavedTableView
  savedTableViews: defineTable({
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    tableId: v.string(),
    name: v.string(),
    config: v.any(),
    isDefault: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_organizationId_userId_tableId_name", ["organizationId", "userId", "tableId", "name"])
    .index("by_userId_tableId", ["userId", "tableId"]),

  // ─── Collaboration substrate ───────────────────────────────────────────────

  // Who is currently viewing / editing a collaborative entity.
  // TTL: expiresAt = lastSeenAt + 45 s. Stale rows are excluded by queries
  // (not hard-deleted) so clients can let them age out naturally.
  collaborationPresence: defineTable({
    orgId: v.string(),
    userId: v.string(),
    userName: v.string(),
    userColor: v.string(),
    avatarUrl: v.optional(v.string()),
    entityType: v.string(), // "project" | "asset" | "client"
    entityId: v.string(),
    section: v.optional(v.string()),
    mode: v.union(v.literal("viewing"), v.literal("editing")),
    activeTargetType: v.optional(v.string()),
    activeTargetId: v.optional(v.string()),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_orgId_entityType_entityId", ["orgId", "entityType", "entityId"])
    .index("by_orgId_userId_entityType_entityId", ["orgId", "userId", "entityType", "entityId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Record-level edit locks. Prevents two users editing the same target
  // simultaneously. Atomic acquire; heartbeat extends expiresAt.
  collaborationLocks: defineTable({
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.string(), // "lineItem" | "section" | "asset" | "client"
    targetId: v.string(),
    ownerUserId: v.string(),
    ownerName: v.string(),
    ownerColor: v.string(),
    acquiredAt: v.number(),
    heartbeatAt: v.number(),
    expiresAt: v.number(),
    releasedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("released"), v.literal("expired")),
    clientSessionId: v.string(),
  })
    .index("by_orgId_entityType_entityId_targetType_targetId", ["orgId", "entityType", "entityId", "targetType", "targetId"])
    .index("by_ownerUserId_status", ["ownerUserId", "status"])
    .index("by_expiresAt", ["expiresAt"]),

  // Comment threads. Each thread belongs to an entity (e.g. project) and
  // optionally a sub-target (e.g. a specific line item).
  commentThreads: defineTable({
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    // Blocking threads gate the project's prep / send-out / forward workflow
    // until resolved. Optional so pre-existing threads default to non-blocking.
    isBlocking: v.optional(v.boolean()),
    // Denormalised project id for cross-project blocking summaries (dashboard /
    // project list). For project comments this equals entityId; carried
    // explicitly so the value is stable even for non-"project" entityTypes.
    projectId: v.optional(v.string()),
    // User ids mentioned anywhere in the thread (union across comments). Drives
    // the dashboard "mentioned in a blocking comment" surface.
    mentionUserIds: v.optional(v.array(v.string())),
    createdBy: v.string(),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_orgId_entityId", ["orgId", "entityId"])
    .index("by_orgId_targetId", ["orgId", "targetId"])
    .index("by_orgId_isBlocking", ["orgId", "isBlocking"])
    .index("by_orgId_isBlocking_status", ["orgId", "isBlocking", "status"])
    .index("by_orgId_projectId", ["orgId", "projectId"])
    .index("by_createdBy", ["createdBy"]),

  // Individual comments within a thread.
  comments: defineTable({
    orgId: v.string(),
    threadId: v.string(), // Convex _id of the commentThreads doc
    body: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    authorColor: v.string(),
    mentionUserIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_threadId", ["threadId"])
    .index("by_orgId_threadId", ["orgId", "threadId"])
    .index("by_orgId_authorId", ["orgId", "authorId"]),

  // Lightweight review/follow-up markers on quote line items and sections.
  // Separate from comment threads: a marker can exist without a discussion.
  reviewMarkers: defineTable({
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    status: v.union(v.literal("needs_review"), v.literal("follow_up"), v.literal("resolved")),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    createdBy: v.string(),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_orgId_entityId", ["orgId", "entityId"])
    .index("by_orgId_targetId", ["orgId", "targetId"])
    .index("by_createdBy", ["createdBy"]),

  // Lightweight activity log for collaboration context (not an audit trail).
  // Records quote changes, comments, markers for the project activity feed.
  activityEvents: defineTable({
    orgId: v.string(),
    actorUserId: v.string(),
    actorName: v.string(),
    actorColor: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_orgId_entityId_createdAt", ["orgId", "entityId", "createdAt"])
    .index("by_orgId_createdAt", ["orgId", "createdAt"]),

  // Denormalised dashboard stat counters (Phase 3). One row per org holding the
  // counts getDashboardStats used to derive by whole-org `.collect()` + JS count
  // — read O(1) by the native dashboard instead of scanning the asset registry /
  // line-item table. Maintained IN-TRANSACTION on every counted write via
  // `bumpCountersForTable` / `bump*Counters` (convex/lib/counters.ts), wired into the
  // generated + custom + native (`*Writes.ts`) mutations and the warehouseOps status
  // choke point (§3.6). `dashboardCounters.reconcile` recomputes authoritatively
  // (backfill + periodic drift backstop; `updatedAt` = last reconcile).
  // Date-derived metrics (maintenanceDue, overdueReturns) are NOT stored here —
  // they're computed at read from bounded indexed queries (nothing writes at the
  // moment a date passes).
  dashboardCounters: defineTable({
    organizationId: v.string(),
    // Reconcile SNAPSHOT of the six counters (the LIVE truth is the sharded counter,
    // convex/lib/shardedCounter.ts — this row is the freshness/ready marker).
    activeAssets: v.number(),
    checkedOutAssets: v.number(),
    bulkQuantity: v.number(),
    activeProjects: v.number(),
    activeCrew: v.number(),
    pendingCrewOffers: v.number(),
    updatedAt: v.number(),
    // Set by reconcile once the SHARDED counters are seeded from a source recompute
    // (gate #3). "Ready" gates on this, NOT row existence: a legacy pre-migration row
    // exists but has unseeded shards, so it must read as not-ready (client falls back
    // a loading state) until reconcileIfStale re-seeds on first view.
    shardsSeededAt: v.optional(v.number()),
  }).index("by_organizationId", ["organizationId"]),

  // ── Project lifecycle locking & versioning (#957/#791/#792/#793) ────────────
  //
  // ProjectSnapshot — whole-project version, parent row. Captured at the
  // forward →CONFIRMED / →COMPLETED transitions and at every unlock-session
  // open (the discard target). Never overwritten — a re-crossing takes a NEW
  // row, so the list is a full version history. See convex/lib/projectSnapshots.ts.
  projectSnapshots: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    // QUOTE_SENT (#986) — the frozen entity state for a quote revision, captured
    // by quotesWrites.sendNative. Unlike the status-driven reasons it carries
    // `revision`, so "as of quote v2" and "the snapshot taken at v2" are the
    // same row (one shared counter — projects.revision).
    reason: v.union(
      v.literal("CONFIRMED"),
      v.literal("COMPLETED"),
      v.literal("UNLOCK"),
      v.literal("QUOTE_SENT"),
    ),
    revision: v.optional(v.number()),
    takenAt: v.number(),
    takenBy: v.string(),
    takenByName: v.optional(v.string()),
    statusFrom: v.optional(v.string()),
    statusTo: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_takenAt", ["projectId", "takenAt"]),

  // ProjectSnapshotEntry — one row per captured entity (project/category/group/
  // lineItem/service/crewAssignment), not a single JSON blob — avoids Convex's
  // ~1MB doc limit on large projects and makes diffing a queryable join instead
  // of a client-side JSON walk. `data` is the entity's field snapshot (no _id/
  // _creationTime — see captureProjectSnapshot).
  projectSnapshotEntries: defineTable({
    id: v.string(),
    organizationId: v.string(),
    snapshotId: v.string(),
    entityType: v.union(
      v.literal("project"),
      v.literal("category"),
      v.literal("group"),
      v.literal("lineItem"),
      v.literal("service"),
      v.literal("crewAssignment"),
    ),
    entityId: v.string(),
    data: v.any(),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_snapshotId", ["snapshotId"])
    .index("by_snapshotId_entityType", ["snapshotId", "entityType"])
    .index("by_snapshotId_entityId", ["snapshotId", "entityId"]),

  // ProjectUnlockSession — at most one OPEN row per project (enforced in the
  // open mutation). `scope: "FINANCIAL"` is #791's finance-only unlock;
  // `scope: "FULL"` is #792's hard-lock override (restricted audience). Both
  // share this table/lifecycle — see convex/projectUnlockSessionsWrites.ts.
  projectUnlockSessions: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    scope: v.union(v.literal("FINANCIAL"), v.literal("FULL")),
    justification: v.string(),
    openedBy: v.string(),
    openedByName: v.optional(v.string()),
    openedAt: v.number(),
    snapshotId: v.string(),
    outcome: v.union(v.literal("OPEN"), v.literal("COMMITTED"), v.literal("DISCARDED")),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.string()),
    closeNote: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_outcome", ["projectId", "outcome"]),

});
