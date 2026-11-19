/**
 * The breadcrumb trail (§6d.2): route segments labelled from the ONE NAV table,
 * plus an optional per-page entity label (`#2341 Hilton Sydney gala dinner`).
 * Pure, so the trail and `document.title` can't drift (the old `segmentLabels` /
 * `getPageTitle` pair is gone). A raw id is NEVER shown as text: an entity segment
 * with no registered label is simply omitted.
 */
import { MODULE_NAMES } from "@/lib/vocabulary";
import { findNavItem, findNavSub, isWithinUrl, type NavItem } from "@/lib/nav";

export interface Crumb {
  label: string;
  /** Absent on the last crumb (the current page, in ink). */
  href?: string;
}

/** Labels for route words that are not a NAV row (create/edit flows, settings pages). */
const SEGMENT_LABELS: Record<string, string> = {
  new: "New",
  edit: "Edit",
  due: "Due",
  "pull-sheet": "Pull sheet",
  builder: "Report builder",
  "api-keys": "API keys",
  sso: "Single sign-on",
  woocommerce: "WooCommerce",
  xero: "Xero",
  "check-items": "Check items",
  "custom-fields": "Custom fields",
  "group-templates": "Group templates",
  mira: "Mira",
  notifications: "Notifications",
  account: "Account",
  changelog: "Changelog",
  "my-tasks": "My tasks",
};

/** A cuid / uuid-looking segment: a record id, never display text. */
export function isIdSegment(segment: string): boolean {
  return /^[a-z0-9_-]{20,}$/i.test(segment) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment);
}

function humanize(segment: string): string {
  const words = segment.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where the module's own url prefix ends, so the remaining segments can be walked. */
function baseOf(item: NavItem, pathname: string): string {
  const sub = findNavSub(pathname);
  if (sub && sub.item.key === item.key && sub.sub.url !== item.url) return sub.sub.url;
  if (isWithinUrl(pathname, item.url)) return item.url;
  return item.matchPrefixes?.find((p) => isWithinUrl(pathname, p)) ?? item.url;
}

function leadingCrumbs(item: NavItem, pathname: string): { crumbs: Crumb[]; base: string } {
  const crumbs: Crumb[] = [{ label: item.label, href: item.url }];
  const base = baseOf(item, pathname);
  const sub = findNavSub(pathname);
  if (sub && sub.item.key === item.key && sub.sub.url === base && base !== item.url) {
    crumbs.push({ label: sub.sub.label, href: sub.sub.url });
  } else if (base !== item.url && !isWithinUrl(base, item.url)) {
    // matchPrefixes route (e.g. /kits under Assets) with no sub-row of its own.
    crumbs.push({ label: humanize(base.split("/").filter(Boolean).pop() ?? ""), href: base });
  }
  return { crumbs, base };
}

function tailCrumbs(rest: string[], base: string, entityLabel: string | undefined): Crumb[] {
  const out: Crumb[] = [];
  let href = base;
  let entityUsed = false;
  for (const seg of rest) {
    href += `/${seg}`;
    if (isIdSegment(seg)) {
      if (entityLabel && !entityUsed) out.push({ label: entityLabel, href });
      entityUsed = true;
    } else {
      out.push({ label: SEGMENT_LABELS[seg] ?? humanize(seg), href });
    }
  }
  return out;
}

/** Trail for `pathname`. The last crumb has no `href`. Never empty ("Home" at worst). */
export function buildTrail(pathname: string, entityLabel?: string): Crumb[] {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const item = findNavItem(clean);
  let crumbs: Crumb[];
  if (item) {
    const { crumbs: lead, base } = leadingCrumbs(item, clean);
    const rest = clean.slice(base.length).split("/").filter(Boolean);
    crumbs = [...lead, ...tailCrumbs(rest, base, entityLabel)];
  } else {
    const segs = clean.split("/").filter(Boolean);
    crumbs = tailCrumbs(segs, "", entityLabel);
  }
  if (crumbs.length === 0) crumbs = [{ label: MODULE_NAMES.home }];
  const last = crumbs.length - 1;
  return crumbs.map((c, i) => (i === last ? { label: c.label } : c));
}
