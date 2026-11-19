"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NavLink } from "@/components/layout/nav-link";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { NAV_FOCUS, navHueText, navTone } from "@/components/layout/nav-tone";
import { isNavItemActive, type NavItem } from "@/lib/nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RailCtx {
  pathname: string;
  onNavigate: () => void;
}

const railClass = (hue: NavItem["hue"], active: boolean) =>
  cn(
    "group relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-[var(--r)] px-1 py-2 transition-colors",
    NAV_FOCUS,
    navTone(hue, active, "text-muted"),
  );

function RailFace({ item }: { item: NavItem }) {
  const Icon = NAV_ICONS[item.icon];
  return (
    <>
      <Icon className="size-5" />
      <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
    </>
  );
}

/** Hover-reveal flyout generated from the NAV row's `subs` (Open X + each sub-page). */
function RailFlyout({ item, ctx }: { item: NavItem; ctx: RailCtx }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const Icon = NAV_ICONS[item.icon];
  const go = (url: string) => {
    ctx.onNavigate();
    router.push(url);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => setOpen(true)}
          className={railClass(item.hue, isNavItemActive(item, ctx.pathname))}
        >
          <RailFace item={item} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-52" onMouseLeave={() => setOpen(false)}>
        <DropdownMenuLabel className={navHueText(item.hue)}>{item.label}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => go(item.url)}>
            <Icon className="mr-2 h-4 w-4" /> Open {item.label}
          </DropdownMenuItem>
          {item.subs?.map((s) => {
            const SubIcon = NAV_ICONS[s.icon];
            return (
              <DropdownMenuItem key={s.key} onClick={() => go(s.url)}>
                <SubIcon className="mr-2 h-4 w-4" /> {s.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The rail's single "More" slot: the secondary group's rows in one flyout. */
function MoreFlyout({ items, ctx }: { items: NavItem[]; ctx: RailCtx }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = items.some((i) => isNavItemActive(i, ctx.pathname));
  const MoreIcon = NAV_ICONS.more;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" onMouseEnter={() => setOpen(true)} className={railClass(null, active)}>
          <MoreIcon className="size-5" />
          <span className="text-[10.5px] font-medium leading-none">More</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-52" onMouseLeave={() => setOpen(false)}>
        <DropdownMenuLabel>More</DropdownMenuLabel>
        <DropdownMenuGroup>
          {items.map((m) => {
            const Icon = NAV_ICONS[m.icon];
            return (
              <DropdownMenuItem
                key={m.key}
                onClick={() => {
                  ctx.onNavigate();
                  router.push(m.url);
                }}
              >
                <Icon className="mr-2 h-4 w-4" /> {m.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailItem({ item, ctx }: { item: NavItem; ctx: RailCtx }) {
  if ((item.subs?.length ?? 0) > 0) return <RailFlyout item={item} ctx={ctx} />;
  return (
    <NavLink
      href={item.url}
      onClick={ctx.onNavigate}
      aria-current={isNavItemActive(item, ctx.pathname) ? "page" : undefined}
      className={railClass(item.hue, isNavItemActive(item, ctx.pathname))}
    >
      <RailFace item={item} />
    </NavLink>
  );
}

/** Rail rows: groups 0 and 1 as icon + label; group 2 collapses into one More flyout. */
export function RailRows({ groups, ctx }: { groups: NavItem[][]; ctx: RailCtx }) {
  const primary = [...groups[0], ...groups[1]];
  const more = groups[2];
  return (
    <>
      {primary.map((item) => (
        <RailItem key={item.key} item={item} ctx={ctx} />
      ))}
      {more.length > 0 && <MoreFlyout items={more} ctx={ctx} />}
    </>
  );
}
