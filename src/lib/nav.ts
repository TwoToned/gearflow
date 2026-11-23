/**
 * The ONE navigation table (UX unification §6d.9, R-3.1).
 *
 * The sidebar, the tablet rail's flyouts, the phone More sheet, the breadcrumb
 * trail and the palette's `@` pages all read THIS table. Pure data, no JSX:
 * icons are resolved by key in `src/components/layout/nav-icons.ts` so Convex-free
 * node tests (the drift test) can import it without pulling in React.
 *
 * Gating lives in `useNavItems()` (`src/hooks/use-nav-items.ts`) — applied once,
 * and a gated item is ABSENT, never greyed.
 */
import { MODULE_NAMES } from "@/lib/vocabulary";
import type { Resource } from "@/lib/permissions";

/** Module accent. `null` = the muted neutral used by the "More" group and Settings. */
export type NavHue = "blue" | "amber" | "green" | "purple" | "coral" | "teal";

export type NavIconKey =
  | "home" | "jobs" | "finance" | "schedule" | "crew" | "assets" | "warehouse"
  | "testTag" | "maintenance" | "clients" | "suppliers" | "locations" | "activity"
  | "settings" | "templates" | "overbookings" | "planner" | "timesheets" | "models"
  | "categories" | "kits" | "roi" | "salesStock" | "returns" | "scan" | "registry" | "quickTest"
  | "reports" | "more";

/** The sidebar's three hairline groups (§6d.2). */
type NavGroupIndex = 0 | 1 | 2;

/** The phone More sheet's groups (§6d.6). */
export type MoreGroup = "plan" | "gear" | "people" | "account";

const MORE_GROUP_LABELS: Record<MoreGroup, string> = {
  plan: "Plan",
  gear: "Crew and gear",
  people: "People",
  account: "Account",
};
const MORE_GROUP_ORDER: readonly MoreGroup[] = ["plan", "gear", "people", "account"];

export interface NavSub {
  key: string;
  label: string;
  url: string;
  icon: NavIconKey;
  /** Any-of. Absent = ungated. */
  resource?: Resource | readonly Resource[];
  /** Fuller label when the row stands alone in the phone More sheet ("Job templates"). */
  moreLabel?: string;
}

export interface NavItem {
  key: string;
  label: string;
  /** Where the row (and its `Open X` flyout entry) goes. */
  url: string;
  icon: NavIconKey;
  hue: NavHue | null;
  group: NavGroupIndex;
  moreGroup: MoreGroup;
  resource?: Resource | readonly Resource[];
  subs?: readonly NavSub[];
  /** Extra path prefixes that make this module "active" (url's own prefix is implied). */
  matchPrefixes?: readonly string[];
}

export const NAV: readonly NavItem[] = [
  // Group 0 — Home has no gate: viewer/warehouse roles keep it without project:read.
  { key: "home", label: MODULE_NAMES.home, url: "/dashboard", icon: "home", hue: "blue", group: 0, moreGroup: "plan" },
  {
    key: "jobs", label: MODULE_NAMES.jobs, url: "/projects", icon: "jobs", hue: "blue", group: 0, moreGroup: "plan",
    resource: "project",
    subs: [
      { key: "job-templates", label: "Templates", url: "/projects/templates", icon: "templates", resource: "project", moreLabel: "Job templates" },
      { key: "overbookings", label: "Overbookings", url: "/overbookings", icon: "overbookings", resource: "project" },
    ],
  },
  { key: "finance", label: "Finance", url: "/finance", icon: "finance", hue: "green", group: 0, moreGroup: "plan", resource: "invoice" },
  { key: "schedule", label: MODULE_NAMES.schedule, url: "/availability", icon: "schedule", hue: "green", group: 0, moreGroup: "plan", resource: "asset" },
  // Group 1
  {
    key: "crew", label: "Crew", url: "/crew", icon: "crew", hue: "purple", group: 1, moreGroup: "gear", resource: "crew",
    subs: [
      { key: "crew-planner", label: "Planner", url: "/crew/planner", icon: "planner", resource: "crew" },
      { key: "crew-timesheets", label: "Timesheets", url: "/crew/timesheets", icon: "timesheets", resource: "crew" },
    ],
  },
  {
    key: "assets", label: "Assets", url: "/assets/registry", icon: "assets", hue: "amber", group: 1, moreGroup: "gear", resource: "asset",
    matchPrefixes: ["/assets", "/kits"],
    subs: [
      { key: "asset-models", label: "Models", url: "/assets/models", icon: "models", resource: "model" },
      { key: "asset-categories", label: "Categories", url: "/assets/categories", icon: "categories", resource: "model" },
      { key: "asset-kits", label: "Kits", url: "/kits", icon: "kits", resource: "kit" },
      { key: "asset-roi", label: "Fleet ROI", url: "/assets/roi", icon: "roi", resource: "model" },
      { key: "asset-sales-stock", label: "Sales Stock", url: "/assets/sales-stock", icon: "salesStock", resource: "model" },
    ],
  },
  {
    key: "warehouse", label: "Warehouse", url: "/warehouse", icon: "warehouse", hue: "teal", group: 1, moreGroup: "gear", resource: "warehouse",
    subs: [
      { key: "warehouse-returns", label: "Returns", url: "/warehouse?mode=returning", icon: "returns", resource: "warehouse" },
      // The Scan page (Phase 16, plan Q6b): Check mode's desktop entry.
      { key: "warehouse-scan", label: "Scan", url: "/scan", icon: "scan", resource: "warehouse" },
    ],
  },
  {
    key: "test-and-tag", label: "Test & Tag", url: "/test-and-tag", icon: "testTag", hue: "teal", group: 1, moreGroup: "gear", resource: "testTag",
    subs: [
      { key: "tt-registry", label: "Registry", url: "/test-and-tag/registry", icon: "registry", resource: "testTag" },
      { key: "tt-quick-test", label: "Quick Test", url: "/test-and-tag/quick-test", icon: "quickTest", resource: "testTag" },
      { key: "tt-reports", label: "Reports", url: "/test-and-tag/reports", icon: "reports", resource: "reports" },
    ],
  },
  { key: "maintenance", label: "Maintenance", url: "/maintenance", icon: "maintenance", hue: "coral", group: 1, moreGroup: "gear", resource: "maintenance" },
  // Group 2 — "More". No hue: these are lookups, not workspaces.
  { key: "clients", label: "Clients", url: "/clients", icon: "clients", hue: null, group: 2, moreGroup: "people", resource: "client" },
  { key: "suppliers", label: "Suppliers", url: "/suppliers", icon: "suppliers", hue: null, group: 2, moreGroup: "people", resource: "supplier" },
  { key: "locations", label: "Locations", url: "/locations", icon: "locations", hue: null, group: 2, moreGroup: "people", resource: "location" },
  { key: "activity", label: "Activity", url: "/activity", icon: "activity", hue: null, group: 2, moreGroup: "account", resource: "reports" },
];

/** Settings sits in the sidebar foot (and the More sheet's Account group), not in a group. */
const SETTINGS_NAV: NavItem = {
  key: "settings", label: "Settings", url: "/settings", icon: "settings", hue: null, group: 2, moreGroup: "account",
  resource: ["orgSettings", "orgMembers"],
};

/** Every module the shell links to, Settings last. */
export const ALL_NAV: readonly NavItem[] = [...NAV, SETTINGS_NAV];

/** The phone bottom bar's three route tabs (Scan and More are not routes). */
const BOTTOM_NAV_KEYS = ["home", "jobs", "warehouse"] as const;
export type BottomNavKey = (typeof BOTTOM_NAV_KEYS)[number];

/**
 * App routes that are deliberately NOT a NAV row (the drift test pins this).
 * `reason` is documentation: each is reached from somewhere that is not the shell.
 */
export const NOT_IN_NAV: Readonly<Record<string, string>> = {
  "/account": "personal; reached from the user menu",
  "/account/notifications": "personal; reached from the account page",
  "/notifications": "reached from the bell's `All notifications`",
  "/changelog": "reached from the user menu / what's-new links",
  "/my-tasks": "removed from the rail (6d.9); still a valid route",
  "/warehouse/returns": "redirect to the floor's Returning mode (`/warehouse?mode=returning`, Phase 4)",
  "/crew/settings": "Settings sub-page for crew; reached from /settings",
  "/maintenance/due": "a filter view reached from Maintenance",
  "/maintenance/new": "create flow",
  "/assets/models/new": "create flow",
  "/assets/registry/new": "create flow",
  "/clients/new": "create flow",
  "/crew/new": "create flow",
  "/kits/new": "create flow",
  "/locations/new": "create flow",
  "/projects/new": "create flow",
  "/projects/templates/new": "create flow",
  "/suppliers/new": "create flow",
  "/test-and-tag/new": "create flow",
};

/** Settings sub-pages are one family; the drift test treats `/settings/*` as covered. */
export const SETTINGS_PREFIX = "/settings";

function norm(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** True when `pathname` is `url` or below it. */
export function isWithinUrl(pathname: string, url: string): boolean {
  const p = norm(pathname);
  return p === url || p.startsWith(url + "/");
}

/** True when `pathname` belongs to the module (its url, a sub url or a match prefix). */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (isWithinUrl(pathname, item.url)) return true;
  if (item.matchPrefixes?.some((p) => isWithinUrl(pathname, p))) return true;
  return !!item.subs?.some((s) => isWithinUrl(pathname, s.url));
}

/** The module owning `pathname`, or null (e.g. /account). First match wins. */
export function findNavItem(pathname: string): NavItem | null {
  return ALL_NAV.find((i) => isNavItemActive(i, pathname)) ?? null;
}

/** The sub-row owning `pathname`, when it is one (longest url wins). */
export function findNavSub(pathname: string): { item: NavItem; sub: NavSub } | null {
  let best: { item: NavItem; sub: NavSub } | null = null;
  for (const item of ALL_NAV) {
    for (const sub of item.subs ?? []) {
      if (isWithinUrl(pathname, sub.url) && (!best || sub.url.length > best.sub.url.length)) best = { item, sub };
    }
  }
  return best;
}

/**
 * Which bottom-bar slot is lit for `pathname`: a route tab, "more" (every other
 * module — Crew, Assets, Settings … — plus the personal /account pages), or null
 * for a route the shell has no opinion on (e.g. /notifications).
 */
export function bottomNavActive(pathname: string): BottomNavKey | "more" | null {
  const item = findNavItem(pathname);
  if (!item) return isWithinUrl(pathname, "/account") ? "more" : null;
  return (BOTTOM_NAV_KEYS as readonly string[]).includes(item.key) ? (item.key as BottomNavKey) : "more";
}

export interface MoreRow {
  key: string;
  label: string;
  url: string;
  icon: NavIconKey;
  /** Drill-down targets (`Open X ›` + these). Empty = a plain link. */
  subs: readonly NavSub[];
}

/**
 * The phone More sheet's groups (§6d.6) from the (already gated) NAV items. The
 * three bottom-bar modules are tabs already, so only their sub-pages appear here
 * (Job templates, Overbookings, Returns) as flat rows; every other module is a row,
 * drillable when it has sub-pages — so all 13 sub-pages stay two taps away.
 */
export function moreSheetGroups(items: readonly NavItem[]): { group: MoreGroup; label: string; rows: MoreRow[] }[] {
  const byGroup = new Map<MoreGroup, MoreRow[]>(MORE_GROUP_ORDER.map((g) => [g, []]));
  for (const item of items) {
    if (item.key === "home") continue;
    const rows = byGroup.get(item.moreGroup)!;
    if ((BOTTOM_NAV_KEYS as readonly string[]).includes(item.key)) {
      for (const s of item.subs ?? []) {
        rows.push({ key: s.key, label: s.moreLabel ?? s.label, url: s.url, icon: s.icon, subs: [] });
      }
    } else {
      rows.push({ key: item.key, label: item.label, url: item.url, icon: item.icon, subs: item.subs ?? [] });
    }
  }
  return MORE_GROUP_ORDER.map((group) => ({ group, label: MORE_GROUP_LABELS[group], rows: byGroup.get(group)! })).filter(
    (g) => g.rows.length > 0,
  );
}

// ── Gating (applied once; consumers never re-check) ────────────────────────────

type PermissionMapLike = Partial<Record<string, readonly string[]>>;

function canSee(resource: NavItem["resource"], permissions: PermissionMapLike | null): boolean {
  if (!resource) return true;
  // Still loading (or no org): permissive, so the shell doesn't flash an empty nav.
  if (!permissions) return true;
  const list = typeof resource === "string" ? [resource] : resource;
  return list.some((r) => (permissions[r]?.length ?? 0) > 0);
}

/** NAV with gated rows and gated sub-rows removed. `permissions: null` = still loading. */
export function visibleNav(permissions: PermissionMapLike | null): NavItem[] {
  return ALL_NAV.filter((i) => canSee(i.resource, permissions)).map((i) =>
    i.subs ? { ...i, subs: i.subs.filter((s) => canSee(s.resource, permissions)) } : i,
  );
}
