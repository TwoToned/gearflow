# Server Actions & API Routes

## Server Action Pattern
All server actions are in `src/server/` with `"use server"` directive. Every function calls `getOrgContext()` for org scoping and `serialize()` on return values.

```typescript
"use server";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { prisma } from "@/lib/prisma";

export async function getItems({ page, pageSize, search, sort, order }) {
  const { organizationId } = await getOrgContext();
  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where: { organizationId, ...filters },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sort]: order },
    }),
    prisma.item.count({ where: { organizationId, ...filters } }),
  ]);
  return serialize({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}
```

## Key Server Action Files
| File | Key Functions |
|------|--------------|
| `assets.ts` | `createAsset`, `createAssets` (bulk), `updateAsset`, `deleteAsset`, `getAssets`, `getAsset` |
| `bulk-assets.ts` | `createBulkAsset`, `updateBulkAsset`, `deleteBulkAsset`, `getBulkAssets`, `getBulkAssetById` |
| `models.ts` | `createModel`, `updateModel`, `deleteModel`, `getModels`, `getModelById`, `getModelWithAssets` |
| `kits.ts` | `createKit`, `updateKit`, `deleteKit`, `getKits`, `getKitById`, `addKitSerializedItems`, `removeKitSerializedItem`, `addKitBulkItems`, `removeKitBulkItem`, `checkOutKit`, `checkInKit` |
| `categories.ts` | `createCategory`, `updateCategory`, `deleteCategory`, `getCategories`, `getCategory`, `getCategoryTree` |
| `locations.ts` | `createLocation`, `updateLocation`, `deleteLocation`, `getLocations`, `getLocationHierarchy` |
| `suppliers.ts` | `getSuppliers`, `getSuppliersPaginated`, `getSupplierById`, `getSupplierAssets`, `getSupplierSubhires`, `createSupplier`, `updateSupplier`, `deleteSupplier` |
| `supplier-orders.ts` | `getSupplierOrders`, `getSupplierOrderById`, `createSupplierOrder`, `updateSupplierOrder`, `updateSupplierOrderStatus`, `deleteSupplierOrder`, `addOrderItem`, `updateOrderItem`, `removeOrderItem` |
| `clients.ts` | `createClient`, `updateClient`, `deleteClient`, `getClients`, `getClientById` |
| `projects.ts` | `createProject`, `updateProject`, `updateProjectStatus`, `deleteProject`, `getProjects`, `getProjectById`, `duplicateProject`, `saveAsTemplate`, `recalculateProjectTotals` |
| `line-items.ts` | `addLineItem`, `updateLineItem`, `deleteLineItem`, `reorderLineItems`, `checkAvailability`, `checkKitAvailability` |
| `warehouse.ts` | `getProjectForWarehouse`, `lookupAssetForScan`, `checkOutItems`, `checkInItems`, `checkOutKit`, `checkInKit`, `getWarehouseProjects`, `getAvailableAssetsForModel`, `quickAddAndCheckOut` |
| `maintenance.ts` | `createMaintenanceRecord`, `updateMaintenanceRecord`, `deleteMaintenanceRecord`, `getMaintenanceRecords`, `getMaintenanceRecordById` |
| `crew.ts` | `getCrewMembers`, `getCrewMemberById`, `createCrewMember`, `updateCrewMember`, `deleteCrewMember`, `getCrewRoles`, `createCrewRole`, `updateCrewRole`, `deleteCrewRole`, `getCrewSkills`, `createCrewSkill`, `deleteCrewSkill`, `addCertification`, `removeCertification`, `getCrewRoleOptions`, `getCrewSkillOptions`, `getCrewDepartments` |
| `crew-assignments.ts` | `getProjectCrew`, `createAssignment`, `updateAssignment`, `deleteAssignment`, `updateAssignmentStatus`, `generateShifts`, `updateShift`, `deleteShift`, `getProjectLabourCost`, `getCrewMembersForAssignment` |
| `search.ts` | `globalSearch(query)` — searches models, assets, bulk assets, kits, projects, clients, locations, categories, suppliers, maintenance, crew |
| `scan-lookup.ts` | `scanLookup(value)` — resolves barcode to `{ url, label }` by checking Asset → Kit → BulkAsset → TestTagAsset |
| `notifications.ts` | `getNotifications()` — 5 types: overdue_maintenance, overdue_return, upcoming_project, low_stock, pending_invitation |
| `dashboard.ts` | `getDashboardStats`, `getRecentActivity`, `getUpcomingProjects` |
| `reports.ts` | `getReportsSummary`, `runReport`, `runReportCSV`, `getSavedReports`, `getSavedReportById`, `saveReport`, `updateSavedReport`, `deleteSavedReport`, `togglePinReport`, `updateReportLastRun` |
| `csv.ts` | `exportModelsCSV`, `exportAssetsCSV`, `exportBulkAssetsCSV`, `importModelsCSV`, `importAssetsCSV` |
| `settings.ts` | `getOrgSettings`, `updateOrgSettings`, `getBrandingSettings`, `updateBrandingSettings` |
| `site-admin.ts` | `getOrganizations`, `getUsers`, `promoteToSiteAdmin`, `banUser`, `getSiteSettings`, `updateSiteSettings` |
| `org-members.ts` | `inviteTeamMember`, `getOrganizationMembers`, `updateMemberRole`, `removeMember` |
| `tags.ts` | `getOrgTags()` — distinct tags across all entity types |
| `activity-log.ts` | `getActivityLogs`, `getEntityActivityLog`, `exportActivityLogCSV` |
| `test-tag-assets.ts` | `createTestTagAsset`, `batchCreateTestTagAssets`, `getTestTagAssets`, `peekNextTestTagIds`, `reserveTestTagIds` |
| `test-tag-records.ts` | `createTestTagRecord`, `recalculateTestTagStatus` |
| `test-tag-reports.ts` | 10 report functions + CSV exports |
| `document-templates.ts` | `getDocumentTemplates`, `getDocumentTemplate`, `createDocumentTemplate`, `updateDocumentTemplate`, `publishDocumentTemplate`, `setDefaultTemplate`, `unsetDefaultTemplate`, `deleteDocumentTemplate`, `duplicateSystemDefault`, `getPublishedTemplatesForDropdown` |

## API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/[...all]` | GET/POST | Better Auth catch-all (login, signup, sessions, OAuth) |
| `/api/current-role` | GET | Get user's role in active org |
| `/api/files/[...path]` | GET | S3 file proxy — validates org prefix on `storageKey` |
| `/api/uploads` | POST | Multipart file upload to S3, returns `FileUpload` metadata |
| `/api/avatar` | POST/DELETE | Upload/remove profile picture |
| `/api/documents/[projectId]` | GET | PDF generation via pdfme (query: `type=quote\|invoice\|pull-slip\|return-sheet\|delivery-docket`, `templateId` optional) |
| `/api/documents/call-sheet/[projectId]` | GET | Call sheet PDF via pdfme (query: `date` optional, `templateId` optional) |
| `/api/documents/template-preview` | POST | Template preview PDF (body: `{ docType, settings }`, returns binary PDF) |
| `/api/reports/pdf` | POST | Report PDF generation via pdfme (body: `{ config, title, subtitle }`) |
| `/api/test-tag-reports/[reportType]` | GET | T&T report PDF/CSV via pdfme (10 types, query: `format=pdf\|csv`) |
| `/api/platform-name` | GET | Public site settings (name, icon, logo, policies) |
| `/api/registration-policy` | GET | Public registration policy only |
| `/api/admin/org-export/[orgId]` | GET | Stream org backup as ZIP (site admin only) |
| `/api/admin/org-import` | POST | Import org from ZIP (site admin only, FormData) |
| `/api/admin-register/verify` | GET | Verify admin registration token |
| `/api/admin-register/promote` | POST | Promote user to site admin (token-gated) |
