/**
 * Page command definitions for @ navigation.
 * Each page has aliases (lowercase, no special chars) that users can type after @.
 * Pages can have children that support drill-down via Tab.
 */

export interface PageCommand {
  /** Display label */
  label: string;
  /** Navigation path */
  href: string;
  /** Aliases for matching (lowercase). First is the canonical name. */
  aliases: string[];
  /** Icon name (maps to lucide icon) */
  icon: string;
  /** Brief description shown as subtitle */
  description: string;
  /** If true, after matching this page, remaining query text is used to deep-search
   *  entities on that page (e.g. @project drum hire → search projects for "drum hire") */
  searchable?: boolean;
  /** Server search type to use for entity search */
  searchType?: string;
  /** Override href prefix for entity results (e.g. "/warehouse" makes project results link to /warehouse/{id}) */
  searchHrefPrefix?: string;
  /** Suffix appended to entity result hrefs (e.g. "?tab=check-in") */
  searchHrefSuffix?: string;
  /** Only show results with these statuses (for project filtering) */
  searchStatusFilter?: string[];
  /** Child pages (sub-navigation items) */
  children?: PageCommand[];
}

export const PAGE_COMMANDS: PageCommand[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    aliases: ["dashboard", "home", "main", "overview", "dash"],
    icon: "LayoutDashboard",
    description: "Overview and recent activity",
  },
  {
    label: "Assets",
    href: "/assets/registry",
    aliases: ["assets", "registry", "assetregistry", "inventory"],
    icon: "Package",
    description: "Asset registry - serialized and bulk assets",
    searchable: true,
    searchType: "asset",
    children: [
      {
        label: "Models",
        href: "/assets/models",
        aliases: ["models", "assetmodels", "equipmentmodels", "types"],
        icon: "Boxes",
        description: "Equipment models and types",
        searchable: true,
        searchType: "model",
      },
      {
        label: "Categories",
        href: "/assets/categories",
        aliases: ["categories", "category", "organize", "groups"],
        icon: "Tags",
        description: "Equipment categories and subcategories",
        searchable: true,
        searchType: "category",
      },
      {
        label: "Kits",
        href: "/kits",
        aliases: ["kits", "kitlist", "cases", "containers"],
        icon: "Box",
        description: "Kit containers and contents",
        searchable: true,
        searchType: "kit",
      },
    ],
  },
  {
    label: "Projects",
    href: "/projects",
    aliases: ["projects", "project", "jobs", "rentals", "hires", "gigs"],
    icon: "FolderOpen",
    description: "Rental projects and jobs",
    searchable: true,
    searchType: "project",
    children: [
      {
        label: "Templates",
        href: "/projects/templates",
        aliases: ["templates", "projecttemplates", "template"],
        icon: "BookTemplate",
        description: "Project templates",
      },
    ],
  },
  {
    label: "Availability",
    href: "/availability",
    aliases: ["availability", "calendar", "avail", "bookings", "schedule"],
    icon: "CalendarRange",
    description: "Asset availability calendar",
  },
  {
    label: "Warehouse",
    href: "/warehouse",
    aliases: ["warehouse", "wh", "scan", "dispatch"],
    icon: "Warehouse",
    description: "Deploy, return, and scanning",
    searchable: true,
    searchType: "project",
    searchHrefPrefix: "/warehouse",
    searchStatusFilter: ["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED"],
    children: [
      {
        label: "Deploy",
        href: "/warehouse",
        aliases: ["deploy", "checkout", "sendout", "prep"],
        icon: "PackageCheck",
        description: "Deploy assets to a project",
        searchable: true,
        searchType: "project",
        searchHrefPrefix: "/warehouse",
        searchHrefSuffix: "?tab=check-out",
        searchStatusFilter: ["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED"],
      },
      {
        label: "Return",
        href: "/warehouse",
        aliases: ["return", "returns", "checkin", "deprep"],
        icon: "PackageX",
        description: "Return deployed assets",
        searchable: true,
        searchType: "project",
        searchHrefPrefix: "/warehouse",
        searchHrefSuffix: "?tab=check-in",
        searchStatusFilter: ["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED"],
      },
    ],
  },
  {
    label: "Clients",
    href: "/clients",
    aliases: ["clients", "client", "customers", "contacts", "companies"],
    icon: "Users",
    description: "Client and contact management",
    searchable: true,
    searchType: "client",
  },
  {
    label: "Suppliers",
    href: "/suppliers",
    aliases: ["suppliers", "supplier", "vendors", "vendor", "purchase", "purchaseorders"],
    icon: "Truck",
    description: "Supplier management and purchase orders",
    searchable: true,
    searchType: "supplier",
    children: [
      {
        label: "Sub-Hires",
        href: "/suppliers",
        aliases: ["subhires", "subhire", "subrentals", "subrental", "crosshires", "crosshire"],
        icon: "PackageOpen",
        description: "Find sub-hire orders by order number, supplier, or items",
        searchable: true,
        searchType: "sub-hire" as const,
      },
    ],
  },
  {
    label: "Crew",
    href: "/crew",
    aliases: ["crew", "crewmembers", "staff", "labour", "labor", "techs", "technicians", "freelancers"],
    icon: "HardHat",
    description: "Crew member management",
    searchable: true,
    searchType: "crew",
    children: [
      {
        label: "Planner",
        href: "/crew/planner",
        aliases: ["planner", "crewplanner", "schedule", "crewschedule", "gantt", "timeline"],
        icon: "CalendarRange",
        description: "Crew planner timeline",
      },
      {
        label: "Timesheets",
        href: "/crew/timesheets",
        aliases: ["timesheets", "timesheet", "time", "hours", "timetracking"],
        icon: "Clock",
        description: "Time tracking and timesheets",
      },
      {
        label: "Roles & Skills",
        href: "/crew/settings",
        aliases: ["crewsettings", "crewroles", "crewskills", "roles", "skills"],
        icon: "Settings",
        description: "Manage crew roles and skills",
      },
    ],
  },
  {
    label: "Locations",
    href: "/locations",
    aliases: ["locations", "location", "venues", "sites", "places", "venue"],
    icon: "MapPin",
    description: "Locations and venues",
    searchable: true,
    searchType: "location",
  },
  {
    label: "Maintenance",
    href: "/maintenance",
    aliases: ["maintenance", "maint", "repairs", "repair", "service", "fix"],
    icon: "Wrench",
    description: "Maintenance records and scheduling",
    searchable: true,
    searchType: "maintenance",
  },
  {
    label: "Test & Tag",
    href: "/test-and-tag",
    aliases: ["testandtag", "tnt", "tt", "testntag", "testtag", "testing", "compliance", "tagging"],
    icon: "ShieldCheck",
    description: "Electrical testing and compliance",
    children: [
      {
        label: "T&T Registry",
        href: "/test-and-tag/registry",
        aliases: ["tntregistry", "ttregistry", "testregistry", "tagregistry"],
        icon: "Package",
        description: "Test & Tag item registry",
      },
      {
        label: "Quick Test",
        href: "/test-and-tag/quick-test",
        aliases: ["quicktest", "qt", "fasttest", "newtest"],
        icon: "ShieldCheck",
        description: "Quick test entry form",
      },
      {
        label: "T&T Reports",
        href: "/test-and-tag/reports",
        aliases: ["tntreports", "ttreports", "testreports", "tagreports", "compliancereports"],
        icon: "BarChart3",
        description: "Test & Tag reports and certificates",
      },
    ],
  },
  {
    label: "Reports",
    href: "/reports",
    aliases: ["reports", "report", "analytics", "stats", "metrics"],
    icon: "BarChart3",
    description: "Business reports and analytics",
    children: [
      {
        label: "Custom Report Builder",
        href: "/reports/builder",
        aliases: ["builder", "customreport", "newreport", "createreport", "buildreport"],
        icon: "BarChart3",
        description: "Build a custom report",
      },
    ],
  },
  {
    label: "Activity Log",
    href: "/activity",
    aliases: ["activity", "activitylog", "audit", "auditlog", "log", "history", "trail"],
    icon: "ScrollText",
    description: "View all activity across the organization",
  },
  {
    label: "Settings",
    href: "/settings",
    aliases: ["settings", "config", "preferences", "prefs", "setup", "options", "admin"],
    icon: "Settings",
    description: "Organization settings and configuration",
    children: [
      {
        label: "Billing",
        href: "/settings/billing",
        aliases: ["billing", "currency", "tax", "gst", "invoicing", "finance"],
        icon: "CreditCard",
        description: "Currency and tax configuration",
      },
      {
        label: "Assets",
        href: "/settings/assets",
        aliases: ["assetsettings", "assettags", "tags"],
        icon: "Package",
        description: "Asset tags configuration",
      },
      {
        label: "Test & Tag Settings",
        href: "/settings/test-and-tag",
        aliases: ["testtagsettings", "tntsettings", "ttsettings", "testconfig"],
        icon: "ShieldCheck",
        description: "Test tag ID format and testing defaults",
      },
      {
        label: "Branding",
        href: "/settings/branding",
        aliases: ["branding", "colors", "colours", "logo", "theme", "customise", "customize"],
        icon: "Palette",
        description: "Colors and logo customization",
      },
      {
        label: "Team",
        href: "/settings/team",
        aliases: ["team", "members", "invites", "invitations", "roles", "permissions", "people", "staff"],
        icon: "Users",
        description: "Team members, roles, and permissions",
      },
      {
        label: "Check Items",
        href: "/settings/check-items",
        aliases: ["checkitems", "checks", "qualitychecks", "qc", "inspections"],
        icon: "ClipboardCheck",
        description: "Quality check item library",
        searchable: true,
        searchType: "check-item" as const,
      },
      {
        label: "Group Templates",
        href: "/settings/group-templates",
        aliases: ["grouptemplates", "templates", "grouptemplate", "groups", "lineitemtemplates"],
        icon: "Bookmark",
        description: "Reusable line item group templates",
        searchable: true,
        searchType: "group-template" as const,
      },
    ],
  },
  {
    label: "Account",
    href: "/account",
    aliases: ["account", "profile", "myaccount", "me", "user", "password", "2fa", "twofactor"],
    icon: "UserCircle",
    description: "Your account, password, and 2FA",
  },
];

/** Normalize string for matching */
function norm(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Score a page command against a query.
 * Returns 0 if no match, higher = better match.
 */
function scoreCommand(cmd: PageCommand, query: string): number {
  const nq = norm(query);
  if (!nq) return 1; // Empty query matches everything

  for (const alias of cmd.aliases) {
    if (alias === nq) return 100;       // Exact match
    if (alias.startsWith(nq)) return 80; // Prefix match
    if (alias.includes(nq)) return 60;   // Substring match
  }

  // Check label
  const nl = norm(cmd.label);
  if (nl === nq) return 95;
  if (nl.startsWith(nq)) return 75;
  if (nl.includes(nq)) return 55;

  // Check description
  const nd = norm(cmd.description);
  if (nd.includes(nq)) return 30;

  // Subsequence match on aliases
  for (const alias of cmd.aliases) {
    let ai = 0;
    for (let qi = 0; qi < nq.length && ai < alias.length; ai++) {
      if (alias[ai] === nq[qi]) qi++;
      if (qi === nq.length) return 15;
    }
  }

  return 0;
}

export interface MatchedPageCommand {
  command: PageCommand;
  score: number;
  /** If set, this is the remaining text after the page alias that should be used for entity search */
  entityQuery?: string;
}

/**
 * Match a query (after @) against all page commands.
 * Returns matched commands sorted by relevance.
 */
export function matchPageCommands(query: string): MatchedPageCommand[] {
  const results: MatchedPageCommand[] = [];

  // Flatten all commands (parents + children)
  const allCommands: PageCommand[] = [];
  for (const cmd of PAGE_COMMANDS) {
    allCommands.push(cmd);
    if (cmd.children) {
      allCommands.push(...cmd.children);
    }
  }

  // Check if query contains a space — first word is the command, rest is entity search
  const spaceIdx = query.indexOf(" ");
  const cmdPart = spaceIdx >= 0 ? query.slice(0, spaceIdx) : query;
  const entityPart = spaceIdx >= 0 ? query.slice(spaceIdx + 1).trim() : "";

  for (const cmd of allCommands) {
    const s = scoreCommand(cmd, cmdPart);
    if (s > 0) {
      results.push({
        command: cmd,
        score: s,
        entityQuery: entityPart || undefined,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Get all page commands (flat list) for initial display when user types just "@".
 */
export function getAllPageCommands(): PageCommand[] {
  const all: PageCommand[] = [];
  for (const cmd of PAGE_COMMANDS) {
    all.push(cmd);
    // Don't include children in the initial flat list — they show as drill-down
  }
  return all;
}
