export const MANIFEST_VERSION = 1;

export interface OrgExportManifest {
  version: number;
  exportedAt: string;
  sourceOrgId: string;
  sourceOrgName: string;
  sourceOrgSlug: string;

  organization: Record<string, unknown>;
  customRoles: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  models: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  bulkAssets: Record<string, unknown>[];
  kits: Record<string, unknown>[];
  kitSerializedItems: Record<string, unknown>[];
  kitBulkItems: Record<string, unknown>[];
  clients: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  projectLineItems: Record<string, unknown>[];
  assetScanLogs: Record<string, unknown>[];
  maintenanceRecords: Record<string, unknown>[];
  maintenanceRecordAssets: Record<string, unknown>[];
  testTagAssets: Record<string, unknown>[];
  testTagRecords: Record<string, unknown>[];
  supplierOrders: Record<string, unknown>[];
  supplierOrderItems: Record<string, unknown>[];
  activityLogs: Record<string, unknown>[];
  fileUploads: Record<string, unknown>[];
  modelMedia: Record<string, unknown>[];
  assetMedia: Record<string, unknown>[];
  kitMedia: Record<string, unknown>[];
  projectMedia: Record<string, unknown>[];
  clientMedia: Record<string, unknown>[];
  locationMedia: Record<string, unknown>[];

  savedReports: Record<string, unknown>[];

  /** Members with user email for matching on import */
  members: Array<{
    role: string;
    userEmail: string;
    userName: string | null;
    createdAt: string;
  }>;

  /** Map of userId -> email for resolving user FKs on import */
  userEmailMap: Record<string, string>;
}
