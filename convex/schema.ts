import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as enums from "./lib/validators";

/**
 * GearFlow Convex schema — generated from prisma/schema.prisma (Phase 1).
 *
 * 96 tables mirroring the Prisma models. Conventions:
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
 * Regenerate with: node scripts/generate-convex-schema.cjs . — if the Prisma
 * schema changes. Review by hand afterwards (generated scaffolding, not final).
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
    .index("by_userId", ["userId"]),

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

  // CustomRole
  customRoles: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.string(),
    ssoGroupClaim: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_name", ["organizationId", "name"]),

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
    weight: v.optional(v.number()),
    powerDraw: v.optional(v.number()),
    requiresTestAndTag: v.optional(v.boolean()),
    testAndTagIntervalDays: v.optional(v.number()),
    defaultEquipmentClass: v.optional(enums.EquipmentClass),
    defaultApplianceType: v.optional(enums.ApplianceType),
    defaultTestProfileId: v.optional(v.string()),
    maintenanceIntervalDays: v.optional(v.number()),
    assetType: v.optional(enums.AssetType),
    barcodeLabelTemplate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_categoryId", ["categoryId"])
    .index("by_defaultTestProfileId", ["defaultTestProfileId"])
    .index("by_organizationId_sku", ["organizationId", "sku"])
    .index("by_isActive", ["isActive"]),

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
    .index("by_organizationId_name", ["organizationId", "name"]),

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
    .index("by_organizationId_projectId", ["organizationId", "projectId"]),

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
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_categoryId", ["categoryId"])
    .index("by_locationId", ["locationId"])
    .index("by_organizationId_assetTag", ["organizationId", "assetTag"])
    .index("by_status", ["status"])
    .index("by_isActive", ["isActive"]),

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
    reorderThreshold: v.optional(v.number()),
    preferredSupplierId: v.optional(v.string()),
    lastReorderedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_modelId", ["modelId"])
    .index("by_locationId", ["locationId"])
    .index("by_preferredSupplierId", ["preferredSupplierId"])
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
    .index("by_scheduledDate", ["scheduledDate"]),

  // DamageEvent
  damageEvents: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.optional(v.string()),
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    severity: enums.DamageSeverity,
    status: v.optional(enums.DamageStatus),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    estimatedCost: v.optional(v.number()),
    actualCost: v.optional(v.number()),
    chargedBack: v.optional(v.boolean()),
    maintenanceRecordId: v.optional(v.string()),
    createdById: v.string(),
    reportedByCrewMemberId: v.optional(v.string()),
    discordIdempotencyKey: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_lineItemId", ["lineItemId"])
    .index("by_lineItemUnitId", ["lineItemUnitId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"])
    .index("by_maintenanceRecordId", ["maintenanceRecordId"])
    .index("by_createdById", ["createdById"])
    .index("by_reportedByCrewMemberId", ["reportedByCrewMemberId"])
    .index("by_discordIdempotencyKey", ["discordIdempotencyKey"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // MaintenanceRecordAsset
  maintenanceRecordAssets: defineTable({
    id: v.string(),
    maintenanceRecordId: v.string(),
    assetId: v.string(),
  })
    .index("by_cuid", ["id"])
    .index("by_maintenanceRecordId", ["maintenanceRecordId"])
    .index("by_assetId", ["assetId"])
    .index("by_maintenanceRecordId_assetId", ["maintenanceRecordId", "assetId"]),

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
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_isActive", ["isActive"]),

  // Project
  projects: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
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
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    billingMonths: v.optional(v.number()),
    billingWeeks: v.optional(v.number()),
    billingDays: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
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
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    discordChannelId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_locationId", ["locationId"])
    .index("by_projectManagerId", ["projectManagerId"])
    .index("by_discordChannelId", ["discordChannelId"])
    .index("by_organizationId_projectNumber", ["organizationId", "projectNumber"])
    .index("by_status", ["status"])
    .index("by_clientId", ["clientId"])
    .index("by_rentalStartDate_rentalEndDate", ["rentalStartDate", "rentalEndDate"])
    .index("by_isTemplate", ["isTemplate"])
    .index("by_organizationId_status", ["organizationId", "status"]),

  // ProjectLineItem
  projectLineItems: defineTable({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: v.optional(enums.LineItemType),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    isKitChild: v.optional(v.boolean()),
    childKind: v.optional(enums.LineItemChildKind),
    parentLineItemId: v.optional(v.string()),
    pricingMode: v.optional(enums.KitPricingMode),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
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
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
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
    .index("by_subHireGroupId", ["subHireGroupId"]),

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
    damageEventsRepointed: v.optional(v.number()),
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
    suggestedPrice: v.optional(v.number()),
    rentalPeriod: v.optional(enums.RentalPeriod),
    rentalQuantity: v.optional(v.number()),
    billingMonths: v.optional(v.number()),
    billingWeeks: v.optional(v.number()),
    billingDays: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
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
    .index("by_scannedAt", ["scannedAt"]),

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
    .index("by_uploadedById", ["uploadedById"]),

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
    .index("by_assetId_fileId", ["assetId", "fileId"]),

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
    socialLoginGoogle: v.optional(v.boolean()),
    socialLoginMicrosoft: v.optional(v.boolean()),
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

  // CrewCertification
  crewCertifications: defineTable({
    id: v.string(),
    crewMemberId: v.string(),
    name: v.string(),
    issuedBy: v.optional(v.string()),
    certificateNumber: v.optional(v.string()),
    issuedDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    status: v.optional(enums.CrewCertStatus),
  })
    .index("by_cuid", ["id"])
    .index("by_crewMemberId", ["crewMemberId"]),

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
    .index("by_crewMemberId_startDate_endDate", ["crewMemberId", "startDate", "endDate"]),

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
    .index("by_crewMemberId_date", ["crewMemberId", "date"]),

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
    taxable: v.optional(v.boolean()),
    lineItemId: v.optional(v.string()),
    vehicleDescription: v.optional(v.string()),
    numberOfTrips: v.optional(v.number()),
    crewCountRequired: v.optional(v.number()),
    crewRoleId: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_projectId", ["projectId"])
    .index("by_lineItemId", ["lineItemId"])
    .index("by_crewRoleId", ["crewRoleId"])
    .index("by_projectId_type", ["projectId", "type"])
    .index("by_projectId_date", ["projectId", "date"]),

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

  // BrandTemplate
  brandTemplates: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    headerSettings: v.string(),
    footerSettings: v.string(),
    accentColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // DocumentTemplate
  documentTemplates: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.string(),
    basePdf: v.optional(v.string()),
    schemas: v.optional(v.string()),
    settings: v.optional(v.string()),
    sections: v.optional(v.string()),
    brandTemplateId: v.optional(v.string()),
    thumbnailData: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isDraft: v.optional(v.boolean()),
    version: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_brandTemplateId", ["brandTemplateId"])
    .index("by_organizationId_type", ["organizationId", "type"]),

  // SectionPreset
  sectionPresets: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    sections: v.string(),
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

  // DiscordIntegration
  discordIntegrations: defineTable({
    id: v.string(),
    organizationId: v.string(),
    isEnabled: v.optional(v.boolean()),
    discordApplicationId: v.optional(v.string()),
    guildId: v.optional(v.string()),
    projectCategoryId: v.optional(v.string()),
    archiveCategoryId: v.optional(v.string()),
    alertChannelId: v.optional(v.string()),
    auditChannelId: v.optional(v.string()),
    channelCreateOnStatuses: v.optional(v.array(enums.ProjectStatus)),
    channelArchiveOnStatuses: v.optional(v.array(enums.ProjectStatus)),
    postWelcomeOnCreate: v.optional(v.boolean()),
    postFaultsToProjectChannel: v.optional(v.boolean()),
    linkTokenTtlMinutes: v.optional(v.number()),
    enrollmentOpen: v.optional(v.boolean()),
    lastHeartbeatAt: v.optional(v.number()),
    botUserId: v.optional(v.string()),
    botDesiredState: v.optional(enums.DiscordBotDesiredState),
    botRestartRequestedAt: v.optional(v.number()),
    botStartError: v.optional(v.string()),
    botPid: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"]),

  // DiscordOutbox
  discordOutboxes: defineTable({
    id: v.number(),
    organizationId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    dedupeKey: v.string(),
    status: v.optional(enums.DiscordOutboxStatus),
    attemptCount: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lockedAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_organizationId_id", ["organizationId", "id"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"]),

  // DiscordAccountLink
  discordAccountLinks: defineTable({
    id: v.string(),
    organizationId: v.string(),
    crewMemberId: v.string(),
    discordUserId: v.string(),
    linkedAt: v.optional(v.number()),
    linkedById: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_crewMemberId", ["crewMemberId"])
    .index("by_organizationId_discordUserId", ["organizationId", "discordUserId"])
    .index("by_discordUserId", ["discordUserId"]),

  // DiscordLinkToken
  discordLinkTokens: defineTable({
    id: v.string(),
    organizationId: v.string(),
    crewMemberId: v.string(),
    tokenHash: v.string(),
    discordUserId: v.string(),
    guildId: v.optional(v.string()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_crewMemberId", ["crewMemberId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),

  // SavedReport
  savedReports: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    dataSource: v.string(),
    config: v.any(),
    createdById: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
    isPinned: v.optional(v.boolean()),
    scheduleFrequency: v.optional(enums.ScheduleFrequency),
    scheduleHour: v.optional(v.number()),
    scheduleDayOfWeek: v.optional(v.number()),
    scheduleDayOfMonth: v.optional(v.number()),
    scheduleRecipients: v.optional(v.array(v.string())),
    scheduleLastRunAt: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdById", ["createdById"])
    .index("by_organizationId_createdById", ["organizationId", "createdById"])
    .index("by_scheduleFrequency_scheduleLastRunAt", ["scheduleFrequency", "scheduleLastRunAt"]),

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

  // Stocktake
  stocktakes: defineTable({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    locationId: v.string(),
    scope: enums.StocktakeScope,
    categoryId: v.optional(v.string()),
    status: v.optional(enums.StocktakeStatus),
    startedAt: v.optional(v.number()),
    startedById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    reviewedById: v.optional(v.string()),
    expectedCount: v.optional(v.number()),
    foundCount: v.optional(v.number()),
    missingCount: v.optional(v.number()),
    unexpectedCount: v.optional(v.number()),
    discrepancyCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_cuid", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_locationId", ["locationId"])
    .index("by_startedById", ["startedById"])
    .index("by_reviewedById", ["reviewedById"]),

  // StocktakeItem
  stocktakeItems: defineTable({
    id: v.string(),
    stocktakeId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    expectedAtLocation: v.optional(v.boolean()),
    expectedQuantity: v.optional(v.number()),
    found: v.optional(v.boolean()),
    foundQuantity: v.optional(v.number()),
    scannedAt: v.optional(v.number()),
    scannedById: v.optional(v.string()),
    result: v.optional(enums.StocktakeItemResult),
    conditionNote: v.optional(v.string()),
    actionTaken: v.optional(v.string()),
  })
    .index("by_cuid", ["id"])
    .index("by_stocktakeId", ["stocktakeId"])
    .index("by_assetId", ["assetId"])
    .index("by_bulkAssetId", ["bulkAssetId"]),

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
    .index("by_assigneeUserId_status", ["assigneeUserId", "status"]),

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

  // Individual comments within a thread.
  comments: defineTable({
    orgId: v.string(),
    threadId: v.string(), // Convex _id of the commentThreads doc
    body: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    authorColor: v.string(),
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

});
