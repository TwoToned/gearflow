/**
 * Slash command registry for context-aware page actions.
 *
 * Commands are scoped to specific pages via route patterns.
 * The current pathname is matched against these patterns to determine
 * which commands are available.
 */

import type { Resource } from "./permissions";

// ─── Types ──────────────────────────────────────────────────────────

export type SlashCommandAction =
  | { type: "navigate"; path: string }
  | { type: "navigate_section"; hash: string }
  | { type: "open_dialog"; dialog: string }
  | { type: "generate_document"; docType: string }
  | { type: "trigger"; event: string };

export interface SlashCommand {
  /** Unique identifier */
  id: string;
  /** Display name: "Generate Pick List" */
  label: string;
  /** What the user types after /: "picklist" */
  command: string;
  /** Alternative triggers */
  aliases: string[];
  /** Shown in command list */
  description: string;
  /** Lucide icon name (maps to pageIcons in command-search) */
  icon: string;
  /** Route patterns where this command is available. "*" = global. */
  pages: string[];
  /** What happens when the command is executed */
  action: SlashCommandAction;
  /** Optional permission check: [resource, action] */
  requiredPermission?: [Resource, string];
}

// ─── Command Registry ───────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Global Commands (available on all pages) ──────────────────────
  {
    id: "global-new-project",
    label: "New Project",
    command: "new-project",
    aliases: ["newproject", "create-project"],
    description: "Create a new project",
    icon: "FolderOpen",
    pages: ["*"],
    action: { type: "navigate", path: "/projects/new" },
    requiredPermission: ["project", "create"],
  },
  {
    id: "global-new-asset",
    label: "New Asset",
    command: "new-asset",
    aliases: ["newasset", "create-asset"],
    description: "Create a new asset",
    icon: "Package",
    pages: ["*"],
    action: { type: "navigate", path: "/assets/registry/new" },
    requiredPermission: ["asset", "create"],
  },
  {
    id: "global-new-kit",
    label: "New Kit",
    command: "new-kit",
    aliases: ["newkit", "create-kit"],
    description: "Create a new kit",
    icon: "Box",
    pages: ["*"],
    action: { type: "navigate", path: "/kits/new" },
    requiredPermission: ["kit", "create"],
  },
  {
    id: "global-new-model",
    label: "New Model",
    command: "new-model",
    aliases: ["newmodel"],
    description: "Create a new model",
    icon: "Boxes",
    pages: ["*"],
    action: { type: "navigate", path: "/assets/models/new" },
    requiredPermission: ["model", "create"],
  },
  {
    id: "global-new-client",
    label: "New Client",
    command: "new-client",
    aliases: ["newclient"],
    description: "Create a new client",
    icon: "Users",
    pages: ["*"],
    action: { type: "navigate", path: "/clients/new" },
    requiredPermission: ["client", "create"],
  },
  {
    id: "global-settings",
    label: "Settings",
    command: "settings",
    aliases: ["preferences", "config"],
    description: "Open settings",
    icon: "Settings",
    pages: ["*"],
    action: { type: "navigate", path: "/settings" },
  },
  {
    id: "global-dashboard",
    label: "Dashboard",
    command: "dashboard",
    aliases: ["home", "overview"],
    description: "Go to dashboard",
    icon: "LayoutDashboard",
    pages: ["*"],
    action: { type: "navigate", path: "/dashboard" },
  },
  {
    id: "global-scan",
    label: "Scan",
    command: "scan",
    aliases: ["scanner", "barcode", "camera"],
    description: "Open warehouse scanner",
    icon: "ScanBarcode",
    pages: ["*"],
    action: { type: "navigate", path: "/warehouse" },
    requiredPermission: ["warehouse", "read"],
  },
  {
    id: "global-availability",
    label: "Availability",
    command: "availability",
    aliases: ["calendar", "avail", "schedule"],
    description: "View asset availability calendar",
    icon: "CalendarRange",
    pages: ["*"],
    action: { type: "navigate", path: "/availability" },
  },
  {
    id: "global-activity",
    label: "Activity Log",
    command: "activity",
    aliases: ["audit", "log", "history"],
    description: "View activity log",
    icon: "ScrollText",
    pages: ["*"],
    action: { type: "navigate", path: "/activity" },
  },
  {
    id: "global-account",
    label: "Account",
    command: "account",
    aliases: ["profile", "myaccount", "me"],
    description: "Your account and profile settings",
    icon: "UserCircle",
    pages: ["*"],
    action: { type: "navigate", path: "/account" },
  },
  {
    id: "global-logout",
    label: "Log Out",
    command: "logout",
    aliases: ["signout", "sign-out", "log-out"],
    description: "Sign out of your account",
    icon: "LogOut",
    pages: ["*"],
    action: { type: "trigger", event: "logout" },
  },

  // ── Project Detail Page (/projects/[id]) ──────────────────────────
  {
    id: "project-picklist",
    label: "Generate Pull Slip",
    command: "picklist",
    aliases: ["pullsheet", "pull-sheet", "pick-list", "picking", "pull-slip", "pullslip"],
    description: "Generate and open pull slip / pick list PDF",
    icon: "ClipboardList",
    pages: ["/projects/[id]"],
    action: { type: "generate_document", docType: "pull-slip" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "project-quote",
    label: "Generate Quote",
    command: "quote",
    aliases: ["quotation"],
    description: "Generate and open quote document",
    icon: "FileText",
    pages: ["/projects/[id]"],
    action: { type: "generate_document", docType: "quote" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "project-invoice",
    label: "Generate Invoice",
    command: "invoice",
    aliases: ["inv"],
    description: "Generate and open invoice",
    icon: "FileText",
    pages: ["/projects/[id]"],
    action: { type: "generate_document", docType: "invoice" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "project-return-sheet",
    label: "Generate Return Sheet",
    command: "return-sheet",
    aliases: ["returnsheet", "returns"],
    description: "Generate and open return sheet",
    icon: "FileText",
    pages: ["/projects/[id]"],
    action: { type: "generate_document", docType: "return-sheet" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "project-delivery-docket",
    label: "Generate Delivery Docket",
    command: "delivery-docket",
    aliases: ["delivery", "docket"],
    description: "Generate and open delivery docket",
    icon: "FileText",
    pages: ["/projects/[id]"],
    action: { type: "generate_document", docType: "delivery-docket" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "project-equipment",
    label: "Equipment",
    command: "equipment",
    aliases: ["line-items", "items", "gear"],
    description: "Switch to equipment tab",
    icon: "Package",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "switch-tab:equipment" },
  },
  {
    id: "project-add-equipment",
    label: "Add Equipment",
    command: "add-equipment",
    aliases: ["add-item", "add-gear"],
    description: "Open the add equipment dialog",
    icon: "PackagePlus",
    pages: ["/projects/[id]"],
    action: { type: "open_dialog", dialog: "add-equipment" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-warehouse",
    label: "Warehouse",
    command: "warehouse",
    aliases: ["checkout", "checkin"],
    description: "Open warehouse view for this project",
    icon: "Warehouse",
    pages: ["/projects/[id]"],
    action: { type: "navigate", path: "/warehouse/:id" },
    requiredPermission: ["warehouse", "read"],
  },
  {
    id: "project-duplicate",
    label: "Duplicate Project",
    command: "duplicate",
    aliases: ["copy", "clone"],
    description: "Duplicate this project",
    icon: "Copy",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "duplicate" },
    requiredPermission: ["project", "create"],
  },
  {
    id: "project-edit",
    label: "Edit Project",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this project",
    icon: "Pencil",
    pages: ["/projects/[id]"],
    action: { type: "navigate", path: "/projects/:id/edit" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-status-confirmed",
    label: "Confirm Project",
    command: "confirm",
    aliases: ["confirmed", "approve"],
    description: "Set project status to Confirmed",
    icon: "CheckCircle",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "set-status:CONFIRMED" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-status-prepping",
    label: "Start Prepping",
    command: "prep",
    aliases: ["prepping", "start-prep"],
    description: "Set project status to Prepping",
    icon: "PackageCheck",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "set-status:PREPPING" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-status-completed",
    label: "Complete Project",
    command: "complete",
    aliases: ["completed", "done", "finish"],
    description: "Set project status to Completed",
    icon: "CircleCheck",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "set-status:COMPLETED" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-status-cancelled",
    label: "Cancel Project",
    command: "cancel",
    aliases: ["cancelled"],
    description: "Set project status to Cancelled",
    icon: "CircleX",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "set-status:CANCELLED" },
    requiredPermission: ["project", "update"],
  },
  {
    id: "project-notes",
    label: "Notes",
    command: "notes",
    aliases: ["note", "comments"],
    description: "Switch to notes tab",
    icon: "StickyNote",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "switch-tab:notes" },
  },
  {
    id: "project-client",
    label: "View Client",
    command: "client",
    aliases: ["customer"],
    description: "Go to this project's client page",
    icon: "Users",
    pages: ["/projects/[id]"],
    action: { type: "trigger", event: "navigate-client" },
  },
  {
    id: "project-share",
    label: "Share Project",
    command: "share",
    aliases: ["send", "invite"],
    description: "Share this project",
    icon: "Share2",
    pages: ["/projects/[id]"],
    action: { type: "open_dialog", dialog: "share" },
    requiredPermission: ["project", "update"],
  },

  // ── Project List Page (/projects) ─────────────────────────────────
  {
    id: "projects-new",
    label: "New Project",
    command: "new",
    aliases: ["create", "add"],
    description: "Create new project",
    icon: "FolderOpen",
    pages: ["/projects"],
    action: { type: "navigate", path: "/projects/new" },
    requiredPermission: ["project", "create"],
  },
  {
    id: "projects-templates",
    label: "Templates",
    command: "templates",
    aliases: ["template"],
    description: "View project templates",
    icon: "BookTemplate",
    pages: ["/projects"],
    action: { type: "navigate", path: "/projects/templates" },
  },

  // ── Asset Detail Page (/assets/registry/[id]) ─────────────────────
  {
    id: "asset-edit",
    label: "Edit Asset",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this asset",
    icon: "Pencil",
    pages: ["/assets/registry/[id]"],
    action: { type: "navigate", path: "/assets/registry/:id/edit" },
    requiredPermission: ["asset", "update"],
  },
  {
    id: "asset-maintenance",
    label: "Create Maintenance",
    command: "maintenance",
    aliases: ["repair", "service"],
    description: "Create maintenance record for this asset",
    icon: "Wrench",
    pages: ["/assets/registry/[id]"],
    action: { type: "open_dialog", dialog: "create-maintenance" },
    requiredPermission: ["maintenance", "create"],
  },
  {
    id: "asset-qr",
    label: "QR Code",
    command: "qr",
    aliases: ["qrcode", "barcode", "label"],
    description: "Generate / print QR code",
    icon: "QrCode",
    pages: ["/assets/registry/[id]"],
    action: { type: "trigger", event: "generate-qr" },
  },
  {
    id: "asset-history",
    label: "History",
    command: "history",
    aliases: ["log", "activity"],
    description: "View asset deployment history",
    icon: "ScrollText",
    pages: ["/assets/registry/[id]"],
    action: { type: "trigger", event: "switch-tab:history" },
  },

  // ── Model Detail Page (/assets/models/[id]) ───────────────────────
  {
    id: "model-edit",
    label: "Edit Model",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this model",
    icon: "Pencil",
    pages: ["/assets/models/[id]"],
    action: { type: "navigate", path: "/assets/models/:id/edit" },
    requiredPermission: ["model", "update"],
  },
  {
    id: "model-new-asset",
    label: "New Asset",
    command: "new-asset",
    aliases: ["add-asset", "create-asset"],
    description: "Create asset of this model",
    icon: "Package",
    pages: ["/assets/models/[id]"],
    action: { type: "navigate", path: "/assets/registry/new?modelId=:id" },
    requiredPermission: ["asset", "create"],
  },
  {
    id: "model-assets",
    label: "Assets",
    command: "assets",
    aliases: ["inventory", "stock"],
    description: "View all assets of this model",
    icon: "Package",
    pages: ["/assets/models/[id]"],
    action: { type: "trigger", event: "switch-tab:assets" },
  },

  // ── Kit Detail Page (/kits/[id]) ──────────────────────────────────
  {
    id: "kit-edit",
    label: "Edit Kit",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this kit",
    icon: "Pencil",
    pages: ["/kits/[id]"],
    action: { type: "navigate", path: "/kits/:id/edit" },
    requiredPermission: ["kit", "update"],
  },
  {
    id: "kit-contents",
    label: "Contents",
    command: "contents",
    aliases: ["items", "assets"],
    description: "View kit contents",
    icon: "Package",
    pages: ["/kits/[id]"],
    action: { type: "navigate_section", hash: "kit-contents" },
  },
  {
    id: "kit-add-item",
    label: "Add Item",
    command: "add-item",
    aliases: ["add-asset"],
    description: "Add asset to kit",
    icon: "PackagePlus",
    pages: ["/kits/[id]"],
    action: { type: "open_dialog", dialog: "add-kit-item" },
    requiredPermission: ["kit", "update"],
  },

  // ── Warehouse Page (/warehouse/[projectId]) ───────────────────────
  {
    id: "warehouse-picklist",
    label: "Generate Pull Slip",
    command: "picklist",
    aliases: ["pullsheet", "pull-sheet", "pick-list", "picking", "pull-slip", "pullslip"],
    description: "Generate pull slip / pick list PDF",
    icon: "ClipboardList",
    pages: ["/warehouse/[id]"],
    action: { type: "generate_document", docType: "pull-slip" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "warehouse-scan",
    label: "Scanner",
    command: "scan",
    aliases: ["camera"],
    description: "Open barcode scanner",
    icon: "ScanBarcode",
    pages: ["/warehouse/[id]"],
    action: { type: "trigger", event: "open-scanner" },
    requiredPermission: ["warehouse", "read"],
  },
  {
    id: "warehouse-project",
    label: "Project Details",
    command: "project",
    aliases: ["details"],
    description: "Go to project detail",
    icon: "FolderOpen",
    pages: ["/warehouse/[id]"],
    action: { type: "navigate", path: "/projects/:id" },
  },
  {
    id: "warehouse-quote",
    label: "Generate Quote",
    command: "quote",
    aliases: ["quotation"],
    description: "Generate quote PDF for this project",
    icon: "FileText",
    pages: ["/warehouse/[id]"],
    action: { type: "generate_document", docType: "quote" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "warehouse-invoice",
    label: "Generate Invoice",
    command: "invoice",
    aliases: ["inv"],
    description: "Generate invoice PDF for this project",
    icon: "FileText",
    pages: ["/warehouse/[id]"],
    action: { type: "generate_document", docType: "invoice" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "warehouse-delivery-docket",
    label: "Generate Delivery Docket",
    command: "delivery-docket",
    aliases: ["delivery", "docket"],
    description: "Generate delivery docket for this project",
    icon: "FileText",
    pages: ["/warehouse/[id]"],
    action: { type: "generate_document", docType: "delivery-docket" },
    requiredPermission: ["document", "create"],
  },
  {
    id: "warehouse-return-sheet",
    label: "Generate Return Sheet",
    command: "return-sheet",
    aliases: ["returnsheet", "returns"],
    description: "Generate return sheet for this project",
    icon: "FileText",
    pages: ["/warehouse/[id]"],
    action: { type: "generate_document", docType: "return-sheet" },
    requiredPermission: ["document", "create"],
  },

  // ── Client Detail Page (/clients/[id]) ────────────────────────────
  {
    id: "client-edit",
    label: "Edit Client",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this client",
    icon: "Pencil",
    pages: ["/clients/[id]"],
    action: { type: "navigate", path: "/clients/:id/edit" },
    requiredPermission: ["client", "update"],
  },
  {
    id: "client-projects",
    label: "Projects",
    command: "projects",
    aliases: ["rentals", "bookings"],
    description: "View client's projects",
    icon: "FolderOpen",
    pages: ["/clients/[id]"],
    action: { type: "trigger", event: "switch-tab:projects" },
  },
  {
    id: "client-new-project",
    label: "New Project",
    command: "new-project",
    aliases: ["create-project"],
    description: "Create project for this client",
    icon: "FolderOpen",
    pages: ["/clients/[id]"],
    action: { type: "navigate", path: "/projects/new?clientId=:id" },
    requiredPermission: ["project", "create"],
  },

  // ── Supplier Detail Page (/suppliers/[id]) ──────────────────────────
  {
    id: "supplier-edit",
    label: "Edit Supplier",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this supplier",
    icon: "Pencil",
    pages: ["/suppliers/[id]"],
    action: { type: "navigate", path: "/suppliers/:id/edit" },
    requiredPermission: ["supplier", "update"],
  },

  // ── Location Detail Page (/locations/[id]) ─────────────────────────
  {
    id: "location-edit",
    label: "Edit Location",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this location",
    icon: "Pencil",
    pages: ["/locations/[id]"],
    action: { type: "navigate", path: "/locations/:id/edit" },
    requiredPermission: ["location", "update"],
  },

  // ── Maintenance Detail Page (/maintenance/[id]) ────────────────────
  {
    id: "maintenance-edit",
    label: "Edit Record",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this maintenance record",
    icon: "Pencil",
    pages: ["/maintenance/[id]"],
    action: { type: "trigger", event: "focus-edit" },
    requiredPermission: ["maintenance", "update"],
  },
  {
    id: "maintenance-complete",
    label: "Mark Complete",
    command: "complete",
    aliases: ["done", "finish", "resolve"],
    description: "Mark this maintenance as complete",
    icon: "CircleCheck",
    pages: ["/maintenance/[id]"],
    action: { type: "trigger", event: "complete-maintenance" },
    requiredPermission: ["maintenance", "update"],
  },

  // ── Maintenance List Page (/maintenance) ───────────────────────────
  {
    id: "maintenance-new",
    label: "New Maintenance",
    command: "new",
    aliases: ["create", "add"],
    description: "Create new maintenance record",
    icon: "Wrench",
    pages: ["/maintenance"],
    action: { type: "navigate", path: "/maintenance/new" },
    requiredPermission: ["maintenance", "create"],
  },

  // ── Asset List Page (/assets/registry) ────────────────────────────
  {
    id: "assets-new",
    label: "New Asset",
    command: "new",
    aliases: ["create", "add"],
    description: "Create new asset",
    icon: "Package",
    pages: ["/assets/registry"],
    action: { type: "navigate", path: "/assets/registry/new" },
    requiredPermission: ["asset", "create"],
  },
  {
    id: "assets-import",
    label: "Import",
    command: "import",
    aliases: ["csv"],
    description: "Import assets from CSV",
    icon: "Upload",
    pages: ["/assets/registry"],
    action: { type: "open_dialog", dialog: "import-csv" },
    requiredPermission: ["asset", "import"],
  },
  {
    id: "assets-export",
    label: "Export",
    command: "export",
    aliases: ["download"],
    description: "Export assets to CSV",
    icon: "Download",
    pages: ["/assets/registry"],
    action: { type: "open_dialog", dialog: "export-csv" },
    requiredPermission: ["asset", "export"],
  },

  // ── Crew List Page (/crew) ──────────────────────────────────────────
  {
    id: "crew-new",
    label: "New Crew Member",
    command: "new",
    aliases: ["create", "add"],
    description: "Create new crew member",
    icon: "HardHat",
    pages: ["/crew"],
    action: { type: "navigate", path: "/crew/new" },
    requiredPermission: ["crew", "create"],
  },
  {
    id: "crew-planner",
    label: "Planner",
    command: "planner",
    aliases: ["schedule", "timeline", "gantt"],
    description: "Open crew planner",
    icon: "CalendarRange",
    pages: ["/crew"],
    action: { type: "navigate", path: "/crew/planner" },
  },
  {
    id: "crew-timesheets",
    label: "Timesheets",
    command: "timesheets",
    aliases: ["timesheet", "time", "hours"],
    description: "View all timesheets",
    icon: "Clock",
    pages: ["/crew"],
    action: { type: "navigate", path: "/crew/timesheets" },
  },
  {
    id: "crew-roles",
    label: "Roles & Skills",
    command: "roles",
    aliases: ["skills", "settings"],
    description: "Manage crew roles and skills",
    icon: "Settings",
    pages: ["/crew"],
    action: { type: "navigate", path: "/crew/settings" },
  },
  {
    id: "crew-log-time",
    label: "Log Time",
    command: "log-time",
    aliases: ["logtime", "addtime", "timeentry"],
    description: "Log time for crew members",
    icon: "Clock",
    pages: ["/crew"],
    action: { type: "open_dialog", dialog: "log-time" },
    requiredPermission: ["crew", "create"],
  },
  {
    id: "crew-export",
    label: "Export Timesheets",
    command: "export",
    aliases: ["download", "csv"],
    description: "Export timesheet data to CSV",
    icon: "Download",
    pages: ["/crew"],
    action: { type: "open_dialog", dialog: "export-timesheets" },
  },

  // ── Crew Detail Page (/crew/[id]) ─────────────────────────────────
  {
    id: "crew-edit",
    label: "Edit Crew Member",
    command: "edit",
    aliases: ["modify"],
    description: "Edit this crew member",
    icon: "Pencil",
    pages: ["/crew/[id]"],
    action: { type: "navigate", path: "/crew/:id/edit" },
    requiredPermission: ["crew", "update"],
  },
  {
    id: "crew-assignments",
    label: "Assignments",
    command: "assignments",
    aliases: ["projects", "jobs"],
    description: "View crew member's assignments",
    icon: "Briefcase",
    pages: ["/crew/[id]"],
    action: { type: "trigger", event: "switch-tab:assignments" },
  },
  {
    id: "crew-availability",
    label: "Availability",
    command: "availability",
    aliases: ["avail", "schedule", "unavailable"],
    description: "View availability blocks",
    icon: "CalendarRange",
    pages: ["/crew/[id]"],
    action: { type: "trigger", event: "switch-tab:availability" },
  },
  {
    id: "crew-certifications",
    label: "Certifications",
    command: "certifications",
    aliases: ["certs", "cert", "qualifications"],
    description: "View certifications",
    icon: "ShieldCheck",
    pages: ["/crew/[id]"],
    action: { type: "trigger", event: "switch-tab:certifications" },
  },
  {
    id: "crew-time",
    label: "Time Entries",
    command: "time",
    aliases: ["timesheet", "hours", "timeentries"],
    description: "View time entries",
    icon: "Clock",
    pages: ["/crew/[id]"],
    action: { type: "trigger", event: "switch-tab:time-entries" },
  },
  {
    id: "crew-calendar",
    label: "Calendar",
    command: "calendar",
    aliases: ["ical", "feed"],
    description: "View calendar and iCal settings",
    icon: "CalendarRange",
    pages: ["/crew/[id]"],
    action: { type: "trigger", event: "switch-tab:calendar" },
  },
  {
    id: "crew-add-availability",
    label: "Add Availability",
    command: "add-availability",
    aliases: ["block", "unavailable", "timeoff"],
    description: "Add availability block",
    icon: "CalendarOff",
    pages: ["/crew/[id]"],
    action: { type: "open_dialog", dialog: "add-availability" },
    requiredPermission: ["crew", "update"],
  },
  {
    id: "crew-add-certification",
    label: "Add Certification",
    command: "add-cert",
    aliases: ["add-certification", "newcert"],
    description: "Add a certification",
    icon: "ShieldCheck",
    pages: ["/crew/[id]"],
    action: { type: "open_dialog", dialog: "add-certification" },
    requiredPermission: ["crew", "update"],
  },
  {
    id: "crew-add-time-entry",
    label: "Log Time",
    command: "log-time",
    aliases: ["logtime", "addtime", "timeentry"],
    description: "Log a time entry for this crew member",
    icon: "Clock",
    pages: ["/crew/[id]"],
    action: { type: "open_dialog", dialog: "add-time-entry" },
    requiredPermission: ["crew", "create"],
  },

  // ── Crew Timesheets Page (/crew/timesheets) ────────────────────────
  {
    id: "timesheets-log-time",
    label: "Log Time",
    command: "log-time",
    aliases: ["logtime", "addtime", "new"],
    description: "Log time for crew members",
    icon: "Clock",
    pages: ["/crew/timesheets"],
    action: { type: "open_dialog", dialog: "log-time" },
    requiredPermission: ["crew", "create"],
  },
  {
    id: "timesheets-export",
    label: "Export CSV",
    command: "export",
    aliases: ["download", "csv"],
    description: "Export timesheets to CSV",
    icon: "Download",
    pages: ["/crew/timesheets"],
    action: { type: "open_dialog", dialog: "export-timesheets" },
  },

  // ── Settings Pages (/settings/*) ──────────────────────────────────
  {
    id: "settings-team",
    label: "Team",
    command: "team",
    aliases: ["members", "users"],
    description: "Team settings",
    icon: "Users",
    pages: ["/settings", "/settings/*"],
    action: { type: "navigate", path: "/settings/team" },
    requiredPermission: ["orgMembers", "read"],
  },
  {
    id: "settings-branding",
    label: "Branding",
    command: "branding",
    aliases: ["logo", "colors"],
    description: "Branding settings",
    icon: "Palette",
    pages: ["/settings", "/settings/*"],
    action: { type: "navigate", path: "/settings/branding" },
    requiredPermission: ["orgSettings", "update"],
  },
  {
    id: "settings-billing",
    label: "Billing",
    command: "billing",
    aliases: ["tax", "currency"],
    description: "Billing settings",
    icon: "CreditCard",
    pages: ["/settings", "/settings/*"],
    action: { type: "navigate", path: "/settings/billing" },
    requiredPermission: ["orgSettings", "update"],
  },
  {
    id: "settings-assets",
    label: "Asset Settings",
    command: "assets",
    aliases: ["tags", "categories"],
    description: "Asset settings",
    icon: "Package",
    pages: ["/settings", "/settings/*"],
    action: { type: "navigate", path: "/settings/assets" },
    requiredPermission: ["orgSettings", "update"],
  },
];

// ─── Route Matching ─────────────────────────────────────────────────

/**
 * Convert a route pattern like "/projects/[id]" to a regex.
 * Supports: exact match, [id] dynamic segments, * wildcard, /path/* wildcard suffix.
 */
function patternToRegex(pattern: string): RegExp {
  if (pattern === "*") return /^.*$/;

  const escaped = pattern
    // Replace [param] with a segment match
    .replace(/\[([^\]]+)\]/g, "([^/]+)")
    // Replace trailing /* with optional wildcard
    .replace(/\/\*$/, "(?:/.*)?");

  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a pathname matches a route pattern.
 */
function matchesPattern(pathname: string, pattern: string): boolean {
  return patternToRegex(pattern).test(pathname);
}

/**
 * Extract the entity ID from a pathname based on common patterns.
 * Looks for UUIDs or cuid-like IDs in the path segments.
 */
export function extractEntityId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  // Walk from the end to find the first segment that looks like an ID
  // (UUID, cuid, or any alphanumeric string that's not a known page segment)
  const knownSegments = new Set([
    "dashboard", "assets", "registry", "models", "categories", "kits",
    "projects", "templates", "warehouse", "clients", "suppliers",
    "locations", "maintenance", "test-and-tag", "reports", "settings",
    "team", "billing", "branding", "account", "availability", "new", "edit",
    "activity", "crew", "planner", "timesheets", "roles", "skills", "quick-test",
    "pull-sheet",
  ]);

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!knownSegments.has(seg) && seg.length > 5) {
      return seg;
    }
  }
  return null;
}

// ─── Filtering & Matching ───────────────────────────────────────────

function normalizeSlash(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Score a slash command against a query string.
 */
function scoreSlashCommand(cmd: SlashCommand, query: string): number {
  const nq = normalizeSlash(query);
  if (!nq) return 1; // Empty query matches all

  const nCmd = normalizeSlash(cmd.command);
  if (nCmd === nq) return 100;
  if (nCmd.startsWith(nq)) return 80;
  if (nCmd.includes(nq)) return 60;

  for (const alias of cmd.aliases) {
    const na = normalizeSlash(alias);
    if (na === nq) return 95;
    if (na.startsWith(nq)) return 75;
    if (na.includes(nq)) return 55;
  }

  const nLabel = normalizeSlash(cmd.label);
  if (nLabel.includes(nq)) return 50;

  const nDesc = normalizeSlash(cmd.description);
  if (nDesc.includes(nq)) return 25;

  // Subsequence match on command name
  let ci = 0;
  for (let qi = 0; qi < nq.length && ci < nCmd.length; ci++) {
    if (nCmd[ci] === nq[qi]) qi++;
    if (qi === nq.length) return 15;
  }

  return 0;
}

export interface MatchedSlashCommand {
  command: SlashCommand;
  score: number;
  /** Whether this is a page-specific command (vs global) */
  isPageSpecific: boolean;
}

/**
 * Get all slash commands available for the given pathname,
 * filtered by query and optionally by permissions.
 */
export function matchSlashCommands(
  query: string,
  pathname: string,
  permissions?: Partial<Record<Resource, readonly string[]>> | null,
): MatchedSlashCommand[] {
  const results: MatchedSlashCommand[] = [];

  for (const cmd of SLASH_COMMANDS) {
    // Check if command is available on this page
    const matchesPage = cmd.pages.some((p) => matchesPattern(pathname, p));
    if (!matchesPage) continue;

    // Check permissions
    if (cmd.requiredPermission && permissions) {
      const [resource, action] = cmd.requiredPermission;
      const allowed = permissions[resource];
      if (!allowed?.includes(action)) continue;
    }

    // Score against query
    const score = scoreSlashCommand(cmd, query);
    if (score > 0) {
      const isPageSpecific = !cmd.pages.includes("*");
      results.push({ command: cmd, score, isPageSpecific });
    }
  }

  // Sort: page-specific first at equal scores, then by score
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isPageSpecific !== b.isPageSpecific) return a.isPageSpecific ? -1 : 1;
    return 0;
  });

  return results;
}
