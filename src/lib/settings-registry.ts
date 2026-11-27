/**
 * The ONE settings registry (UX Phase 17, spec §9k.6, D57). The index, its
 * search, the section header and the per-route gate all read this table — it
 * replaces the hand-kept `settingsNav` that lived in `settings/layout.tsx`.
 * Pure data + pure functions: no React, so the drift test can walk it.
 *
 * Adding a settings page = one row here (and its `page.tsx`). `parts` are the
 * named parts inside the page, so a bare search for `tax` finds General,
 * Billing, Services and Xero without the page having to be opened.
 */

/** What a role needs to open an entry. Evaluated ONCE by `settingsGateOpen`. */
export type SettingsGate = "orgSettings" | "orgMembers" | "checkItem" | "lineItems" | "xero";

/** The capabilities the gates read — supplied by `useSettingsGate` on the client. */
export interface SettingsCaps {
  orgSettingsRead: boolean;
  orgMembersRead: boolean;
  checkItemRead: boolean;
  projectManageLineItems: boolean;
  /** `invoice:xero_manage` AND the deployment has a Xero developer app. */
  xeroManage: boolean;
}

/** Whether the queries behind the caps have answered yet. */
export interface SettingsCapsLoad {
  rolesLoaded: boolean;
  xeroLoaded: boolean;
}

/**
 * A gate can only be decided once the inputs it reads have loaded: a closed
 * capability that is merely not-yet-known must never read as "denied" (a deep
 * link to /settings/xero flashed Access denied while the caps query ran).
 */
export function settingsGateKnown(gate: SettingsGate, load: SettingsCapsLoad): boolean {
  if (!load.rolesLoaded) return false;
  return gate === "xero" ? load.xeroLoaded : true;
}

export type SettingsStatusKey = "team" | "xero" | "mira";

export type SettingsGroupKey =
  | "organisation"
  | "people"
  | "operations"
  | "money"
  | "integrations"
  | "developer"
  | "danger";

export interface SettingsEntry {
  key: string;
  title: string;
  description: string;
  href: string;
  group: SettingsGroupKey;
  gate: SettingsGate;
  /** The named parts inside the page — searched alongside title and description. */
  parts: readonly string[];
  /** A derived status word shown at the right of the index row (never stored). */
  statusKey?: SettingsStatusKey;
}

export const SETTINGS_GROUPS: readonly { key: SettingsGroupKey; label: string }[] = [
  { key: "organisation", label: "Organisation" },
  { key: "people", label: "People & access" },
  { key: "operations", label: "Operations" },
  { key: "money", label: "Money" },
  { key: "integrations", label: "Integrations" },
  { key: "developer", label: "Developer" },
  { key: "danger", label: "Danger zone" },
];

export const SETTINGS: readonly SettingsEntry[] = [
  {
    key: "general", title: "General", href: "/settings/general", group: "organisation", gate: "orgSettings",
    description: "Business identity, timezone, job numbering, automatic job status and crew-planner timing.",
    parts: ["business name", "email", "phone", "website", "address", "abn", "country", "timezone", "job defaults", "job numbering", "project number", "status automation", "crew & time", "confirmation reminders"],
  },
  {
    key: "branding", title: "Branding & documents", href: "/settings/branding", group: "organisation", gate: "orgSettings",
    description: "Logo, colours and the footer, terms and payment details printed on documents.",
    parts: ["logo", "icon", "colours", "primary colour", "accent colour", "document colour", "document branding", "footer text", "terms & conditions", "payment details", "quote validity", "payment terms"],
  },
  {
    key: "team", title: "Team", href: "/settings/team", group: "people", gate: "orgMembers", statusKey: "team",
    description: "Members, invitations, join requests and what each role can do.",
    parts: ["members", "invite", "invitations", "join policy", "join requests", "roles", "permissions"],
  },
  {
    key: "sso", title: "Single sign-on", href: "/settings/sso", group: "people", gate: "orgSettings",
    description: "Sign in with your identity provider, provisioning, group-to-role mapping and login behaviour.",
    parts: ["saml", "oidc", "identity providers", "user provisioning", "group-to-role mapping", "login behaviour", "pending approvals"],
  },
  {
    key: "assets", title: "Assets", href: "/settings/assets", group: "operations", gate: "orgSettings",
    description: "Asset tag format, which categories are containers, and your categories, suppliers and locations.",
    parts: ["asset tags", "tag format", "prefix", "containers", "cases", "category", "categories", "subcategories", "suppliers", "vendors", "locations", "warehouses", "venues"],
  },
  {
    key: "custom-fields", title: "Custom fields", href: "/settings/custom-fields", group: "operations", gate: "orgSettings",
    description: "Extra fields on assets: text, number, date, dropdown or yes/no.",
    parts: ["fields", "attributes", "dropdown", "asset fields"],
  },
  {
    key: "test-and-tag", title: "Test & tag", href: "/settings/test-and-tag", group: "operations", gate: "orgSettings",
    description: "Test tag ID format, test profiles, default intervals, email reminders and auditor portal links.",
    parts: ["test tag id", "test profiles", "visual checks", "electrical tests", "testing defaults", "intervals", "email reminders", "digest", "auditor portal", "compliance links"],
  },
  {
    key: "check-items", title: "Check items", href: "/settings/check-items", group: "operations", gate: "checkItem",
    description: "The quality checks you assign to models for warehouse prep and return.",
    parts: ["quality checks", "prep", "return checks", "model checks"],
  },
  {
    key: "group-templates", title: "Group templates", href: "/settings/group-templates", group: "operations", gate: "lineItems",
    description: "Saved bundles of gear you can drop onto a job as a priced group.",
    parts: ["bundles", "project groups", "templates"],
  },
  {
    key: "services", title: "Services", href: "/settings/services", group: "operations", gate: "orgSettings",
    description: "Service templates: the labour, transport and other services you add to jobs, with default price and crew.",
    parts: ["service templates", "default price", "pricing type", "crew count", "vehicle", "show on documents", "auto-add"],
  },
  {
    key: "calendars", title: "Calendars", href: "/settings/calendars", group: "operations", gate: "orgSettings",
    description: "The iCal feeds your team subscribes to from Google, Apple or Outlook, and the token behind them.",
    parts: ["ical", "calendar feeds", "subscribe", "google calendar", "outlook", "token", "regenerate"],
  },
  {
    key: "displays", title: "Displays", href: "/settings/displays", group: "operations", gate: "orgSettings",
    description: "Warehouse display screens: named display URLs with a layout and optional location.",
    parts: ["screens", "display url", "layout", "tv", "kiosk", "regenerate url", "revoke"],
  },
  {
    key: "billing", title: "Billing", href: "/settings/billing", group: "money", gate: "orgSettings",
    description: "Currency, the default tax rate and how invoices are numbered.",
    parts: ["currency", "tax", "tax rate", "gst", "vat", "tax label", "invoice numbering", "invoice number"],
  },
  {
    key: "xero", title: "Xero", href: "/settings/xero", group: "integrations", gate: "xero", statusKey: "xero",
    description: "Push invoices to Xero, map clients and set account coding.",
    parts: ["accounting", "tax", "tax type", "account coding", "account codes", "reference data", "client mapping", "payments", "invoice push", "connect"],
  },
  {
    key: "woocommerce", title: "WooCommerce", href: "/settings/woocommerce", group: "integrations", gate: "orgSettings",
    description: "Take WooCommerce orders into Flow: webhook, product matching, field mapping and job defaults.",
    parts: ["webhook", "connection", "product matching", "date field mapping", "location mapping", "job defaults", "recent orders", "wordpress"],
  },
  {
    key: "mira", title: "Mira assistant", href: "/settings/mira", group: "integrations", gate: "orgSettings", statusKey: "mira",
    description: "The in-app assistant: your own API key, model and base URL, and whether it may write.",
    parts: ["ai", "openrouter", "api key", "base url", "model", "write access"],
  },
  {
    key: "api-keys", title: "API keys", href: "/settings/api-keys", group: "developer", gate: "orgSettings",
    description: "Keys and connections for agents, scripts and MCP clients.",
    parts: ["mcp", "tokens", "agent", "oauth", "scopes", "request log", "rotate", "revoke", "no financials"],
  },
  {
    key: "danger-zone", title: "Danger zone", href: "/settings/danger-zone", group: "danger", gate: "orgSettings",
    description: "Emergency switches: turn off every API key at once.",
    parts: ["kill switch", "disable api", "emergency"],
  },
];

/** The ONE gate rule. A gated entry is absent from the index, never greyed. */
export function settingsGateOpen(gate: SettingsGate, caps: SettingsCaps): boolean {
  switch (gate) {
    case "orgSettings":
      return caps.orgSettingsRead;
    case "orgMembers":
      return caps.orgMembersRead;
    case "checkItem":
      return caps.checkItemRead;
    case "lineItems":
      return caps.projectManageLineItems;
    case "xero":
      return caps.xeroManage;
  }
}

export function visibleSettings(caps: SettingsCaps): SettingsEntry[] {
  return SETTINGS.filter((e) => settingsGateOpen(e.gate, caps));
}

/** Entries a role cannot open — for the index's one muted footer line. */
export function hiddenSettings(caps: SettingsCaps): SettingsEntry[] {
  return SETTINGS.filter((e) => !settingsGateOpen(e.gate, caps));
}

/** Case-insensitive match over title, description and the parts inside the page. */
export function searchSettings(entries: readonly SettingsEntry[], query: string): SettingsEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => [e.title, e.description, ...e.parts].some((s) => s.toLowerCase().includes(q)));
}

/** The entry a pathname belongs to: longest href prefix wins; `/settings` itself is the index. */
export function settingsEntryForPath(pathname: string): SettingsEntry | null {
  const matches = SETTINGS.filter((e) => pathname === e.href || pathname.startsWith(e.href + "/"));
  matches.sort((a, b) => b.href.length - a.href.length);
  return matches[0] ?? null;
}
