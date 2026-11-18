"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavLink } from "@/components/layout/nav-link";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { NAV_FOCUS, navHueText, navTone } from "@/components/layout/nav-tone";
import { isNavItemActive, isWithinUrl, type NavItem, type NavSub } from "@/lib/nav";

interface RowCtx {
  pathname: string;
  onNavigate: () => void;
}

function SubRow({ sub, hue, ctx }: { sub: NavSub; hue: NavItem["hue"]; ctx: RowCtx }) {
  const active = isWithinUrl(ctx.pathname, sub.url);
  return (
    <NavLink
      href={sub.url}
      onClick={ctx.onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-[var(--r)] py-1.5 pl-9 pr-2.5 text-[13px] transition-colors",
        NAV_FOCUS,
        active ? `bg-elev ${navHueText(hue)}` : `text-muted hover:bg-elev hover:text-ink`,
      )}
    >
      <span className="truncate">{sub.label}</span>
    </NavLink>
  );
}

/** On the module's own page (not one of its sub-pages). */
function isModulePage(item: NavItem, pathname: string): boolean {
  return isNavItemActive(item, pathname) && !item.subs?.some((s) => isWithinUrl(pathname, s.url));
}

/** The hover/focus `›` that reveals a module's sub-pages when it isn't the active one. */
function SubToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${open ? "Hide" : "Show"} ${label} pages`}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted opacity-0 transition hover:bg-elev hover:text-ink focus-visible:opacity-100 group-hover/mod:opacity-100",
        open && "opacity-100",
        NAV_FOCUS,
      )}
    >
      <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
    </button>
  );
}

/**
 * One module row. Sub-pages show under the ACTIVE module and, for any module, on
 * the hover/focus `›` toggle (D67) — so all of them stay reachable, none shout.
 */
function ModuleRow({ item, ctx }: { item: NavItem; ctx: RowCtx }) {
  const [open, setOpen] = useState(false);
  const Icon = NAV_ICONS[item.icon];
  const active = isNavItemActive(item, ctx.pathname);
  const subs = item.subs ?? [];
  const showSubs = subs.length > 0 && (active || open);

  return (
    <div className="group/mod flex flex-col" data-nav-key={item.key}>
      <div className="relative">
        <NavLink
          href={item.url}
          onClick={ctx.onNavigate}
          aria-current={isModulePage(item, ctx.pathname) ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 pr-8 text-[14px] font-medium transition-colors",
            NAV_FOCUS,
            navTone(item.hue, active),
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </NavLink>
        {subs.length > 0 && !active && (
          <SubToggle label={item.label} open={open} onToggle={() => setOpen((o) => !o)} />
        )}
      </div>
      {showSubs && subs.map((s) => <SubRow key={s.key} sub={s} hue={item.hue} ctx={ctx} />)}
    </div>
  );
}

/** The expanded sidebar's three hairline groups; the third is labelled "More". */
export function SidebarGroups({ groups, ctx }: { groups: NavItem[][]; ctx: RowCtx }) {
  const filled = groups.map((items, index) => ({ items, index })).filter((g) => g.items.length > 0);
  return (
    <>
      {filled.map(({ items, index }, n) => (
        <div
          key={index}
          role="group"
          aria-label={index === 2 ? "More" : undefined}
          className={cn("flex flex-col gap-0.5", n > 0 && "mt-1.5 border-t border-line pt-1.5")}
        >
          {index === 2 && <span className="t-overline px-2.5 pb-1 text-muted">More</span>}
          {items.map((item) => (
            <ModuleRow key={item.key} item={item} ctx={ctx} />
          ))}
        </div>
      ))}
    </>
  );
}

export function SettingsRow({ item, ctx, compact }: { item: NavItem; ctx: RowCtx; compact?: boolean }) {
  const Icon = NAV_ICONS[item.icon];
  const active = isNavItemActive(item, ctx.pathname);
  return (
    <NavLink
      href={item.url}
      onClick={ctx.onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex cursor-pointer rounded-[var(--r)] transition-colors",
        NAV_FOCUS,
        compact ? "w-full flex-col items-center gap-1 px-1 py-2" : "items-center gap-2.5 px-2.5 py-2 text-[14px] font-medium",
        navTone(null, active, compact ? "text-muted" : "text-ink-2"),
      )}
    >
      <Icon className={compact ? "size-5" : "size-4 shrink-0"} />
      <span className={compact ? "text-[10.5px] font-medium leading-none" : "truncate"}>{item.label}</span>
    </NavLink>
  );
}
