/**
 * Report system type definitions.
 * Shared between client and server.
 */

export const DATA_SOURCES = [
  "assets",
  "models",
  "projects",
  "kits",
  "lineItems",
  "clients",
  "locations",
  "maintenance",
  "activityLog",
  "crew",
  "crewAssignments",
] as const;

export type DataSource = (typeof DATA_SOURCES)[number];

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  assets: "Assets",
  models: "Models",
  projects: "Projects",
  kits: "Kits",
  lineItems: "Line Items",
  clients: "Clients",
  locations: "Locations",
  maintenance: "Maintenance",
  activityLog: "Activity Log",
  crew: "Crew Members",
  crewAssignments: "Crew Assignments",
};

export const DATA_SOURCE_ICONS: Record<DataSource, string> = {
  assets: "Package",
  models: "Boxes",
  projects: "FolderOpen",
  kits: "Box",
  lineItems: "List",
  clients: "Users",
  locations: "MapPin",
  maintenance: "Wrench",
  activityLog: "ScrollText",
  crew: "HardHat",
  crewAssignments: "UserCheck",
};

export const DATA_SOURCE_DESCRIPTIONS: Record<DataSource, string> = {
  assets: "Serialized asset inventory, status, and history",
  models: "Equipment models with utilisation and popularity",
  projects: "Projects with financials, status, and dates",
  kits: "Kit containers and their contents",
  lineItems: "Individual rental line items across projects",
  clients: "Client information and revenue metrics",
  locations: "Warehouses, venues, and site locations",
  maintenance: "Maintenance records and costs",
  activityLog: "Audit trail of all user actions",
  crew: "Crew members, skills, and availability",
  crewAssignments: "Crew assignments, hours, and costs",
};

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty"
  | "between";

export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";

export interface ColumnConfig {
  field: string;
  label?: string;
  visible: boolean;
  width?: number;
}

export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | string[] | [string, string];
}

export interface GroupByConfig {
  field: string;
  aggregateColumns: {
    field: string;
    function: AggregateFunction;
    label?: string;
  }[];
}

export interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

export interface DateRangeConfig {
  field: string;
  start?: string;
  end?: string;
  preset?: string;
}

export interface ReportConfig {
  dataSource: DataSource;
  columns: ColumnConfig[];
  filters: FilterConfig[];
  groupBy?: GroupByConfig;
  sortBy?: SortConfig[];
  dateRange?: DateRangeConfig;
  limit?: number;
  includeInactive?: boolean;
}

export interface ReportResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  columns: ColumnConfig[];
  aggregations?: Record<string, number>;
  executedAt: string;
}

// ─── Field Definitions ────────────────────────────────────────────────────────

export type FieldType = "string" | "number" | "date" | "boolean" | "enum";

export interface FieldDefinition {
  field: string;
  label: string;
  type: FieldType;
  section: "core" | "related" | "computed";
  enumValues?: string[];
  enumLabels?: Record<string, string>;
}

// ─── Data Source Field Definitions ────────────────────────────────────────────

export const FIELD_DEFINITIONS: Record<DataSource, FieldDefinition[]> = {
  assets: [
    { field: "assetTag", label: "Asset Tag", type: "string", section: "core" },
    { field: "customName", label: "Custom Name", type: "string", section: "core" },
    { field: "serialNumber", label: "Serial Number", type: "string", section: "core" },
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "LOST", "RESERVED"], enumLabels: { AVAILABLE: "Available", CHECKED_OUT: "Deployed", IN_MAINTENANCE: "In Maintenance", RETIRED: "Retired", LOST: "Lost", RESERVED: "Reserved" } },
    { field: "condition", label: "Condition", type: "enum", section: "core", enumValues: ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"], enumLabels: { NEW: "New", GOOD: "Good", FAIR: "Fair", POOR: "Poor", DAMAGED: "Damaged" } },
    { field: "purchaseDate", label: "Purchase Date", type: "date", section: "core" },
    { field: "purchasePrice", label: "Purchase Price", type: "number", section: "core" },
    { field: "warrantyExpiry", label: "Warranty Expiry", type: "date", section: "core" },
    { field: "notes", label: "Notes", type: "string", section: "core" },
    { field: "isActive", label: "Active", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "model.name", label: "Model Name", type: "string", section: "related" },
    { field: "model.manufacturer", label: "Manufacturer", type: "string", section: "related" },
    { field: "model.modelNumber", label: "Model Number", type: "string", section: "related" },
    { field: "model.category.name", label: "Category", type: "string", section: "related" },
    { field: "model.defaultRentalPrice", label: "Rental Price", type: "number", section: "related" },
    { field: "model.replacementCost", label: "Replacement Cost", type: "number", section: "related" },
    { field: "model.weight", label: "Weight", type: "number", section: "related" },
    { field: "location.name", label: "Location", type: "string", section: "related" },
    { field: "supplier.name", label: "Supplier", type: "string", section: "related" },
    { field: "kit.name", label: "Kit", type: "string", section: "related" },
  ],

  models: [
    { field: "name", label: "Name", type: "string", section: "core" },
    { field: "manufacturer", label: "Manufacturer", type: "string", section: "core" },
    { field: "modelNumber", label: "Model Number", type: "string", section: "core" },
    { field: "defaultRentalPrice", label: "Rental Price", type: "number", section: "core" },
    { field: "defaultPurchasePrice", label: "Purchase Price", type: "number", section: "core" },
    { field: "replacementCost", label: "Replacement Cost", type: "number", section: "core" },
    { field: "weight", label: "Weight (kg)", type: "number", section: "core" },
    { field: "powerDraw", label: "Power Draw (W)", type: "number", section: "core" },
    { field: "assetType", label: "Asset Type", type: "enum", section: "core", enumValues: ["SERIALIZED", "BULK"], enumLabels: { SERIALIZED: "Serialized", BULK: "Bulk" } },
    { field: "isActive", label: "Active", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "category.name", label: "Category", type: "string", section: "related" },
    { field: "_count.assets", label: "Total Assets", type: "number", section: "computed" },
    { field: "_availableCount", label: "Available Count", type: "number", section: "computed" },
    { field: "_checkedOutCount", label: "Deployed Count", type: "number", section: "computed" },
    { field: "_totalRevenue", label: "Total Revenue", type: "number", section: "computed" },
  ],

  projects: [
    { field: "projectNumber", label: "Project Number", type: "string", section: "core" },
    { field: "name", label: "Name", type: "string", section: "core" },
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED", "CANCELLED"], enumLabels: { ENQUIRY: "Enquiry", QUOTING: "Quoting", QUOTED: "Quoted", CONFIRMED: "Confirmed", PREPPING: "Prepping", CHECKED_OUT: "Deployed", ON_SITE: "On Site", RETURNED: "Returned", COMPLETED: "Completed", INVOICED: "Invoiced", CANCELLED: "Cancelled" } },
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["DRY_HIRE", "WET_HIRE", "INSTALLATION", "TOUR", "CORPORATE", "THEATRE", "FESTIVAL", "CONFERENCE", "OTHER"] },
    { field: "loadInDate", label: "Load In Date", type: "date", section: "core" },
    { field: "eventStartDate", label: "Event Start", type: "date", section: "core" },
    { field: "eventEndDate", label: "Event End", type: "date", section: "core" },
    { field: "loadOutDate", label: "Load Out Date", type: "date", section: "core" },
    { field: "rentalStartDate", label: "Rental Start", type: "date", section: "core" },
    { field: "rentalEndDate", label: "Rental End", type: "date", section: "core" },
    { field: "subtotal", label: "Subtotal", type: "number", section: "core" },
    { field: "discountPercent", label: "Discount %", type: "number", section: "core" },
    { field: "taxAmount", label: "Tax Amount", type: "number", section: "core" },
    { field: "total", label: "Total", type: "number", section: "core" },
    { field: "depositPaid", label: "Deposit Paid", type: "number", section: "core" },
    { field: "invoicedTotal", label: "Invoiced Total", type: "number", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "client.name", label: "Client", type: "string", section: "related" },
    { field: "client.type", label: "Client Type", type: "string", section: "related" },
    { field: "location.name", label: "Location", type: "string", section: "related" },
    { field: "projectManager.name", label: "Project Manager", type: "string", section: "related" },
    { field: "_lineItemCount", label: "Line Items", type: "number", section: "computed" },
  ],

  kits: [
    { field: "assetTag", label: "Asset Tag", type: "string", section: "core" },
    { field: "name", label: "Name", type: "string", section: "core" },
    { field: "description", label: "Description", type: "string", section: "core" },
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "INCOMPLETE"], enumLabels: { AVAILABLE: "Available", CHECKED_OUT: "Deployed", IN_MAINTENANCE: "In Maintenance", RETIRED: "Retired", INCOMPLETE: "Incomplete" } },
    { field: "condition", label: "Condition", type: "enum", section: "core", enumValues: ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] },
    { field: "weight", label: "Weight", type: "number", section: "core" },
    { field: "caseType", label: "Case Type", type: "string", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "category.name", label: "Category", type: "string", section: "related" },
    { field: "location.name", label: "Location", type: "string", section: "related" },
    { field: "_serializedItemCount", label: "Serialized Items", type: "number", section: "computed" },
    { field: "_bulkItemCount", label: "Bulk Items", type: "number", section: "computed" },
  ],

  lineItems: [
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["EQUIPMENT", "SERVICE", "LABOUR", "TRANSPORT", "MISC"] },
    { field: "description", label: "Description", type: "string", section: "core" },
    { field: "quantity", label: "Quantity", type: "number", section: "core" },
    { field: "unitPrice", label: "Unit Price", type: "number", section: "core" },
    { field: "pricingType", label: "Pricing Type", type: "enum", section: "core", enumValues: ["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR"] },
    { field: "duration", label: "Duration", type: "number", section: "core" },
    { field: "discount", label: "Discount", type: "number", section: "core" },
    { field: "lineTotal", label: "Line Total", type: "number", section: "core" },
    { field: "groupName", label: "Group", type: "string", section: "core" },
    { field: "isOptional", label: "Optional", type: "boolean", section: "core" },
    { field: "isSubhire", label: "Subhire", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "project.projectNumber", label: "Project #", type: "string", section: "related" },
    { field: "project.name", label: "Project Name", type: "string", section: "related" },
    { field: "project.status", label: "Project Status", type: "string", section: "related" },
    { field: "project.client.name", label: "Client", type: "string", section: "related" },
    { field: "model.name", label: "Model", type: "string", section: "related" },
    { field: "model.category.name", label: "Category", type: "string", section: "related" },
    { field: "asset.assetTag", label: "Asset Tag", type: "string", section: "related" },
    { field: "kit.name", label: "Kit", type: "string", section: "related" },
    { field: "supplier.name", label: "Supplier", type: "string", section: "related" },
  ],

  clients: [
    { field: "name", label: "Name", type: "string", section: "core" },
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["COMPANY", "INDIVIDUAL", "VENUE", "PRODUCTION_COMPANY"], enumLabels: { COMPANY: "Company", INDIVIDUAL: "Individual", VENUE: "Venue", PRODUCTION_COMPANY: "Production Company" } },
    { field: "contactName", label: "Contact Name", type: "string", section: "core" },
    { field: "contactEmail", label: "Contact Email", type: "string", section: "core" },
    { field: "contactPhone", label: "Contact Phone", type: "string", section: "core" },
    { field: "paymentTerms", label: "Payment Terms", type: "string", section: "core" },
    { field: "defaultDiscount", label: "Default Discount", type: "number", section: "core" },
    { field: "isActive", label: "Active", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "_totalProjects", label: "Total Projects", type: "number", section: "computed" },
    { field: "_totalRevenue", label: "Total Revenue", type: "number", section: "computed" },
  ],

  locations: [
    { field: "name", label: "Name", type: "string", section: "core" },
    { field: "address", label: "Address", type: "string", section: "core" },
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["WAREHOUSE", "VENUE", "VEHICLE", "OFFSITE"], enumLabels: { WAREHOUSE: "Warehouse", VENUE: "Venue", VEHICLE: "Vehicle", OFFSITE: "Offsite" } },
    { field: "isDefault", label: "Default", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "parent.name", label: "Parent Location", type: "string", section: "related" },
    { field: "_assetCount", label: "Asset Count", type: "number", section: "computed" },
    { field: "_kitCount", label: "Kit Count", type: "number", section: "computed" },
  ],

  maintenance: [
    { field: "title", label: "Title", type: "string", section: "core" },
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["REPAIR", "PREVENTATIVE", "TEST_AND_TAG", "INSPECTION", "CLEANING", "FIRMWARE_UPDATE"], enumLabels: { REPAIR: "Repair", PREVENTATIVE: "Preventative", TEST_AND_TAG: "Test & Tag", INSPECTION: "Inspection", CLEANING: "Cleaning", FIRMWARE_UPDATE: "Firmware Update" } },
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], enumLabels: { SCHEDULED: "Scheduled", IN_PROGRESS: "In Progress", COMPLETED: "Completed", CANCELLED: "Cancelled" } },
    { field: "description", label: "Description", type: "string", section: "core" },
    { field: "scheduledDate", label: "Scheduled Date", type: "date", section: "core" },
    { field: "completedDate", label: "Completed Date", type: "date", section: "core" },
    { field: "cost", label: "Cost", type: "number", section: "core" },
    { field: "result", label: "Result", type: "enum", section: "core", enumValues: ["PASS", "FAIL", "CONDITIONAL"] },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "reportedBy.name", label: "Reported By", type: "string", section: "related" },
    { field: "assignedTo.name", label: "Assigned To", type: "string", section: "related" },
  ],

  activityLog: [
    { field: "action", label: "Action", type: "string", section: "core" },
    { field: "entityType", label: "Entity Type", type: "string", section: "core" },
    { field: "entityName", label: "Entity Name", type: "string", section: "core" },
    { field: "summary", label: "Summary", type: "string", section: "core" },
    { field: "userName", label: "User", type: "string", section: "core" },
    { field: "createdAt", label: "Date", type: "date", section: "core" },
  ],

  crew: [
    { field: "firstName", label: "First Name", type: "string", section: "core" },
    { field: "lastName", label: "Last Name", type: "string", section: "core" },
    { field: "email", label: "Email", type: "string", section: "core" },
    { field: "phone", label: "Phone", type: "string", section: "core" },
    { field: "type", label: "Type", type: "enum", section: "core", enumValues: ["EMPLOYEE", "FREELANCER", "CONTRACTOR", "VOLUNTEER"], enumLabels: { EMPLOYEE: "Employee", FREELANCER: "Freelancer", CONTRACTOR: "Contractor", VOLUNTEER: "Volunteer" } },
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["ACTIVE", "INACTIVE", "ON_LEAVE", "ARCHIVED"], enumLabels: { ACTIVE: "Active", INACTIVE: "Inactive", ON_LEAVE: "On Leave", ARCHIVED: "Archived" } },
    { field: "department", label: "Department", type: "string", section: "core" },
    { field: "defaultDayRate", label: "Day Rate", type: "number", section: "core" },
    { field: "defaultHourlyRate", label: "Hourly Rate", type: "number", section: "core" },
    { field: "isActive", label: "Active", type: "boolean", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "crewRole.name", label: "Role", type: "string", section: "related" },
    { field: "_totalAssignments", label: "Total Assignments", type: "number", section: "computed" },
  ],

  crewAssignments: [
    { field: "status", label: "Status", type: "enum", section: "core", enumValues: ["PENDING", "OFFERED", "ACCEPTED", "DECLINED", "CONFIRMED", "CANCELLED", "COMPLETED"], enumLabels: { PENDING: "Pending", OFFERED: "Offered", ACCEPTED: "Accepted", DECLINED: "Declined", CONFIRMED: "Confirmed", CANCELLED: "Cancelled", COMPLETED: "Completed" } },
    { field: "phase", label: "Phase", type: "enum", section: "core", enumValues: ["BUMP_IN", "EVENT", "BUMP_OUT", "DELIVERY", "PICKUP", "SETUP", "REHEARSAL", "FULL_DURATION"] },
    { field: "isProjectManager", label: "Project Manager", type: "boolean", section: "core" },
    { field: "startDate", label: "Start Date", type: "date", section: "core" },
    { field: "endDate", label: "End Date", type: "date", section: "core" },
    { field: "rateOverride", label: "Rate Override", type: "number", section: "core" },
    { field: "estimatedHours", label: "Estimated Hours", type: "number", section: "core" },
    { field: "estimatedCost", label: "Estimated Cost", type: "number", section: "core" },
    { field: "createdAt", label: "Created", type: "date", section: "core" },
    { field: "crewMember.firstName", label: "First Name", type: "string", section: "related" },
    { field: "crewMember.lastName", label: "Last Name", type: "string", section: "related" },
    { field: "crewMember.type", label: "Crew Type", type: "string", section: "related" },
    { field: "crewRole.name", label: "Role", type: "string", section: "related" },
    { field: "project.projectNumber", label: "Project #", type: "string", section: "related" },
    { field: "project.name", label: "Project Name", type: "string", section: "related" },
    { field: "project.client.name", label: "Client", type: "string", section: "related" },
  ],
};

// ─── Pre-Built Report Templates ──────────────────────────────────────────────

export interface PreBuiltReport {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  config: ReportConfig;
}

export const PRE_BUILT_REPORTS: PreBuiltReport[] = [
  // ─── Asset Reports ──────────────────────────────────────────────────
  {
    id: "asset-inventory",
    name: "Asset Inventory",
    description: "Complete list of all assets with status and location",
    category: "Assets",
    icon: "Package",
    config: {
      dataSource: "assets",
      columns: [
        { field: "assetTag", visible: true },
        { field: "customName", visible: true },
        { field: "model.name", visible: true },
        { field: "model.manufacturer", visible: true },
        { field: "model.category.name", visible: true },
        { field: "status", visible: true },
        { field: "condition", visible: true },
        { field: "location.name", visible: true },
        { field: "serialNumber", visible: true },
      ],
      filters: [],
      sortBy: [{ field: "assetTag", direction: "asc" }],
    },
  },
  {
    id: "asset-utilisation",
    name: "Asset Utilisation",
    description: "How often each equipment model is rented out",
    category: "Assets",
    icon: "TrendingUp",
    config: {
      dataSource: "models",
      columns: [
        { field: "name", visible: true },
        { field: "manufacturer", visible: true },
        { field: "category.name", visible: true },
        { field: "_count.assets", visible: true },
        { field: "_availableCount", visible: true },
        { field: "_checkedOutCount", visible: true },
        { field: "defaultRentalPrice", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "_checkedOutCount", direction: "desc" }],
    },
  },
  {
    id: "model-popularity",
    name: "Model Popularity",
    description: "Most frequently booked equipment models",
    category: "Assets",
    icon: "Star",
    config: {
      dataSource: "models",
      columns: [
        { field: "name", visible: true },
        { field: "manufacturer", visible: true },
        { field: "category.name", visible: true },
        { field: "_count.assets", visible: true },
        { field: "_totalRevenue", visible: true },
        { field: "defaultRentalPrice", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "_totalRevenue", direction: "desc" }],
    },
  },
  {
    id: "asset-value",
    name: "Asset Value by Category",
    description: "Total value of inventory grouped by category",
    category: "Assets",
    icon: "DollarSign",
    config: {
      dataSource: "assets",
      columns: [
        { field: "model.category.name", visible: true },
        { field: "purchasePrice", visible: true },
        { field: "model.replacementCost", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      groupBy: {
        field: "model.category.name",
        aggregateColumns: [
          { field: "*", function: "count", label: "Asset Count" },
          { field: "purchasePrice", function: "sum", label: "Total Purchase Value" },
          { field: "model.replacementCost", function: "sum", label: "Total Replacement Value" },
        ],
      },
      sortBy: [{ field: "model.category.name", direction: "asc" }],
    },
  },
  {
    id: "warranty-expiry",
    name: "Warranty Expiry",
    description: "Assets with warranties expiring in the next 90 days",
    category: "Assets",
    icon: "ShieldAlert",
    config: {
      dataSource: "assets",
      columns: [
        { field: "assetTag", visible: true },
        { field: "model.name", visible: true },
        { field: "model.manufacturer", visible: true },
        { field: "warrantyExpiry", visible: true },
        { field: "purchaseDate", visible: true },
        { field: "supplier.name", visible: true },
      ],
      filters: [
        { field: "warrantyExpiry", operator: "gte", value: new Date().toISOString().split("T")[0] },
        { field: "isActive", operator: "equals", value: true },
      ],
      dateRange: { field: "warrantyExpiry", preset: "next90days" },
      sortBy: [{ field: "warrantyExpiry", direction: "asc" }],
    },
  },

  // ─── Project Reports ────────────────────────────────────────────────
  {
    id: "project-summary",
    name: "Project Summary",
    description: "All projects by status with financial totals",
    category: "Projects",
    icon: "FolderOpen",
    config: {
      dataSource: "projects",
      columns: [
        { field: "status", visible: true },
        { field: "total", visible: true },
      ],
      filters: [{ field: "isTemplate", operator: "equals", value: false }],
      groupBy: {
        field: "status",
        aggregateColumns: [
          { field: "*", function: "count", label: "Project Count" },
          { field: "total", function: "sum", label: "Total Value" },
        ],
      },
      sortBy: [{ field: "status", direction: "asc" }],
    },
  },
  {
    id: "revenue-by-client",
    name: "Revenue by Client",
    description: "Total revenue grouped by client",
    category: "Projects",
    icon: "DollarSign",
    config: {
      dataSource: "projects",
      columns: [
        { field: "client.name", visible: true },
        { field: "total", visible: true },
      ],
      filters: [
        { field: "status", operator: "in", value: ["COMPLETED", "INVOICED"] },
        { field: "isTemplate", operator: "equals", value: false },
      ],
      groupBy: {
        field: "client.name",
        aggregateColumns: [
          { field: "*", function: "count", label: "Project Count" },
          { field: "total", function: "sum", label: "Total Revenue" },
          { field: "total", function: "avg", label: "Avg Project Value" },
        ],
      },
      sortBy: [{ field: "total", direction: "desc" }],
    },
  },
  {
    id: "overdue-returns",
    name: "Overdue Returns",
    description: "Projects past their rental end date that are still active",
    category: "Projects",
    icon: "AlertTriangle",
    config: {
      dataSource: "projects",
      columns: [
        { field: "projectNumber", visible: true },
        { field: "name", visible: true },
        { field: "client.name", visible: true },
        { field: "status", visible: true },
        { field: "rentalEndDate", visible: true },
        { field: "total", visible: true },
        { field: "location.name", visible: true },
      ],
      filters: [
        { field: "rentalEndDate", operator: "lt", value: new Date().toISOString().split("T")[0] },
        { field: "status", operator: "in", value: ["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"] },
        { field: "isTemplate", operator: "equals", value: false },
      ],
      sortBy: [{ field: "rentalEndDate", direction: "asc" }],
    },
  },
  {
    id: "projects-by-location",
    name: "Projects by Location",
    description: "All projects grouped by venue/location",
    category: "Projects",
    icon: "MapPin",
    config: {
      dataSource: "projects",
      columns: [
        { field: "location.name", visible: true },
        { field: "total", visible: true },
      ],
      filters: [{ field: "isTemplate", operator: "equals", value: false }],
      groupBy: {
        field: "location.name",
        aggregateColumns: [
          { field: "*", function: "count", label: "Project Count" },
          { field: "total", function: "sum", label: "Total Value" },
        ],
      },
      sortBy: [{ field: "location.name", direction: "asc" }],
    },
  },
  {
    id: "subhire-summary",
    name: "Subhire Summary",
    description: "All subhired items across projects, grouped by supplier",
    category: "Projects",
    icon: "Truck",
    config: {
      dataSource: "lineItems",
      columns: [
        { field: "supplier.name", visible: true },
        { field: "lineTotal", visible: true },
      ],
      filters: [{ field: "isSubhire", operator: "equals", value: true }],
      groupBy: {
        field: "supplier.name",
        aggregateColumns: [
          { field: "*", function: "count", label: "Item Count" },
          { field: "lineTotal", function: "sum", label: "Total Cost" },
        ],
      },
      sortBy: [{ field: "lineTotal", direction: "desc" }],
    },
  },
  {
    id: "project-profitability",
    name: "Project Profitability",
    description: "Revenue vs costs per project",
    category: "Projects",
    icon: "TrendingUp",
    config: {
      dataSource: "projects",
      columns: [
        { field: "projectNumber", visible: true },
        { field: "name", visible: true },
        { field: "client.name", visible: true },
        { field: "status", visible: true },
        { field: "total", visible: true },
        { field: "eventStartDate", visible: true },
        { field: "eventEndDate", visible: true },
      ],
      filters: [
        { field: "status", operator: "in", value: ["COMPLETED", "INVOICED"] },
        { field: "isTemplate", operator: "equals", value: false },
      ],
      sortBy: [{ field: "total", direction: "desc" }],
    },
  },

  // ─── Kit Reports ────────────────────────────────────────────────────
  {
    id: "kit-inventory",
    name: "Kit Inventory",
    description: "All kits with contents summary",
    category: "Kits",
    icon: "Box",
    config: {
      dataSource: "kits",
      columns: [
        { field: "assetTag", visible: true },
        { field: "name", visible: true },
        { field: "status", visible: true },
        { field: "condition", visible: true },
        { field: "category.name", visible: true },
        { field: "location.name", visible: true },
        { field: "_serializedItemCount", visible: true },
        { field: "_bulkItemCount", visible: true },
      ],
      filters: [],
      sortBy: [{ field: "name", direction: "asc" }],
    },
  },
  {
    id: "kit-utilisation",
    name: "Kit Utilisation",
    description: "Kit checkout frequency and status",
    category: "Kits",
    icon: "BarChart3",
    config: {
      dataSource: "kits",
      columns: [
        { field: "assetTag", visible: true },
        { field: "name", visible: true },
        { field: "status", visible: true },
        { field: "category.name", visible: true },
        { field: "_serializedItemCount", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "name", direction: "asc" }],
    },
  },

  // ─── Client Reports ─────────────────────────────────────────────────
  {
    id: "client-revenue",
    name: "Client Revenue",
    description: "Revenue per client with project count",
    category: "Clients",
    icon: "Users",
    config: {
      dataSource: "clients",
      columns: [
        { field: "name", visible: true },
        { field: "type", visible: true },
        { field: "contactName", visible: true },
        { field: "contactEmail", visible: true },
        { field: "_totalProjects", visible: true },
        { field: "_totalRevenue", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "_totalRevenue", direction: "desc" }],
    },
  },
  {
    id: "top-clients",
    name: "Top Clients",
    description: "Highest revenue clients (top 20)",
    category: "Clients",
    icon: "Trophy",
    config: {
      dataSource: "clients",
      columns: [
        { field: "name", visible: true },
        { field: "type", visible: true },
        { field: "_totalProjects", visible: true },
        { field: "_totalRevenue", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "_totalRevenue", direction: "desc" }],
      limit: 20,
    },
  },

  // ─── Maintenance Reports ────────────────────────────────────────────
  {
    id: "maintenance-costs",
    name: "Maintenance Costs",
    description: "Total maintenance spend by type",
    category: "Maintenance",
    icon: "Wrench",
    config: {
      dataSource: "maintenance",
      columns: [
        { field: "type", visible: true },
        { field: "cost", visible: true },
      ],
      filters: [],
      groupBy: {
        field: "type",
        aggregateColumns: [
          { field: "*", function: "count", label: "Record Count" },
          { field: "cost", function: "sum", label: "Total Cost" },
          { field: "cost", function: "avg", label: "Avg Cost" },
        ],
      },
      sortBy: [{ field: "type", direction: "asc" }],
    },
  },
  {
    id: "open-maintenance",
    name: "Open Maintenance",
    description: "All incomplete maintenance records",
    category: "Maintenance",
    icon: "Clock",
    config: {
      dataSource: "maintenance",
      columns: [
        { field: "title", visible: true },
        { field: "type", visible: true },
        { field: "status", visible: true },
        { field: "scheduledDate", visible: true },
        { field: "cost", visible: true },
        { field: "assignedTo.name", visible: true },
        { field: "reportedBy.name", visible: true },
      ],
      filters: [
        { field: "status", operator: "in", value: ["SCHEDULED", "IN_PROGRESS"] },
      ],
      sortBy: [{ field: "scheduledDate", direction: "asc" }],
    },
  },

  // ─── Crew Reports ───────────────────────────────────────────────────
  {
    id: "crew-roster",
    name: "Crew Roster",
    description: "Full crew list with roles, department, and rates",
    category: "Crew",
    icon: "HardHat",
    config: {
      dataSource: "crew",
      columns: [
        { field: "firstName", visible: true },
        { field: "lastName", visible: true },
        { field: "email", visible: true },
        { field: "phone", visible: true },
        { field: "type", visible: true },
        { field: "status", visible: true },
        { field: "department", visible: true },
        { field: "crewRole.name", visible: true },
        { field: "defaultDayRate", visible: true },
        { field: "defaultHourlyRate", visible: true },
      ],
      filters: [{ field: "isActive", operator: "equals", value: true }],
      sortBy: [{ field: "lastName", direction: "asc" }],
    },
  },
  {
    id: "crew-utilisation",
    name: "Crew Utilisation",
    description: "How many projects/hours each crew member has worked",
    category: "Crew",
    icon: "UserCheck",
    config: {
      dataSource: "crewAssignments",
      columns: [
        { field: "crewMember.firstName", visible: true },
        { field: "crewMember.lastName", visible: true },
        { field: "crewRole.name", visible: true },
        { field: "project.name", visible: true },
        { field: "status", visible: true },
        { field: "phase", visible: true },
        { field: "estimatedHours", visible: true },
        { field: "estimatedCost", visible: true },
      ],
      filters: [
        { field: "status", operator: "in", value: ["CONFIRMED", "COMPLETED"] },
      ],
      sortBy: [{ field: "crewMember.lastName", direction: "asc" }],
    },
  },
  {
    id: "labour-cost-by-project",
    name: "Labour Cost by Project",
    description: "Total labour cost per project",
    category: "Crew",
    icon: "Calculator",
    config: {
      dataSource: "crewAssignments",
      columns: [
        { field: "project.name", visible: true },
        { field: "estimatedCost", visible: true },
      ],
      filters: [
        { field: "status", operator: "in", value: ["CONFIRMED", "COMPLETED"] },
      ],
      groupBy: {
        field: "project.name",
        aggregateColumns: [
          { field: "*", function: "count", label: "Crew Count" },
          { field: "estimatedHours", function: "sum", label: "Total Hours" },
          { field: "estimatedCost", function: "sum", label: "Total Cost" },
        ],
      },
      sortBy: [{ field: "estimatedCost", direction: "desc" }],
    },
  },
  {
    id: "freelancer-spend",
    name: "Freelancer Spend",
    description: "Total spend on freelancers grouped by crew member",
    category: "Crew",
    icon: "Wallet",
    config: {
      dataSource: "crewAssignments",
      columns: [
        { field: "crewMember.firstName", visible: true },
        { field: "crewMember.lastName", visible: true },
        { field: "estimatedCost", visible: true },
      ],
      filters: [
        { field: "crewMember.type", operator: "equals", value: "FREELANCER" },
        { field: "status", operator: "in", value: ["CONFIRMED", "COMPLETED"] },
      ],
      groupBy: {
        field: "crewMember.lastName",
        aggregateColumns: [
          { field: "*", function: "count", label: "Assignments" },
          { field: "estimatedHours", function: "sum", label: "Total Hours" },
          { field: "estimatedCost", function: "sum", label: "Total Cost" },
        ],
      },
      sortBy: [{ field: "estimatedCost", direction: "desc" }],
    },
  },

  // ─── Warehouse / Activity Reports ───────────────────────────────────
  {
    id: "activity-log",
    name: "Activity Log",
    description: "Complete audit trail of all actions",
    category: "Operations",
    icon: "ScrollText",
    config: {
      dataSource: "activityLog",
      columns: [
        { field: "createdAt", visible: true },
        { field: "userName", visible: true },
        { field: "action", visible: true },
        { field: "entityType", visible: true },
        { field: "entityName", visible: true },
        { field: "summary", visible: true },
      ],
      filters: [],
      sortBy: [{ field: "createdAt", direction: "desc" }],
      limit: 500,
    },
  },
  {
    id: "location-summary",
    name: "Location Summary",
    description: "Locations with asset and kit counts",
    category: "Operations",
    icon: "MapPin",
    config: {
      dataSource: "locations",
      columns: [
        { field: "name", visible: true },
        { field: "type", visible: true },
        { field: "address", visible: true },
        { field: "_assetCount", visible: true },
        { field: "_kitCount", visible: true },
      ],
      filters: [],
      sortBy: [{ field: "name", direction: "asc" }],
    },
  },
];

/** Group pre-built reports by category */
export function getReportsByCategory(): Record<string, PreBuiltReport[]> {
  const groups: Record<string, PreBuiltReport[]> = {};
  for (const report of PRE_BUILT_REPORTS) {
    if (!groups[report.category]) groups[report.category] = [];
    groups[report.category].push(report);
  }
  return groups;
}
