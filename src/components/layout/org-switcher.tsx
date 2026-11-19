"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { orgInitials, useOrgSwitch } from "@/hooks/use-org-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/**
 * The org switcher — the sidebar head (D69). The row names the active org; with
 * one membership it is a plain label (nothing to switch), with two or more it
 * opens the Organisations menu. `compact` is the rail's initials tile.
 */
export function OrgSwitcher({ compact }: { compact?: boolean }) {
  const { orgs, activeOrgId, activeOrgName, switchingId, switchTo } = useOrgSwitch();
  const name = activeOrgName ?? "Organisation";
  const initials = orgInitials(activeOrgName);
  const switchable = orgs.length >= 2;

  const face = compact ? (
    <span className="flex size-8 items-center justify-center rounded-[var(--r)] bg-elev font-mono text-[11px] font-medium text-ink-2">
      {initials}
    </span>
  ) : (
    <>
      <span className="truncate text-[13px] font-medium text-ink">{name}</span>
      {switchable && <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted" aria-hidden />}
    </>
  );
  const rowClass = cn(
    "flex w-full items-center rounded-[var(--r)] transition-colors",
    compact ? "justify-center py-1" : "gap-2 px-2.5 py-1.5",
  );

  if (!switchable) {
    return (
      <div className={rowClass} title={name} aria-label={`Organisation: ${name}`}>
        {face}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Organisation: ${name}`}
          title={name}
          className={cn(rowClass, "cursor-pointer hover:bg-elev data-[state=open]:bg-elev", FOCUS)}
        >
          {face}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start" side={compact ? "right" : "bottom"} sideOffset={compact ? 8 : 4}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] font-normal text-muted">Organisations</DropdownMenuLabel>
          {orgs.map((org) => (
            <OrgItem key={org.id} org={org} active={org.id === activeOrgId} switching={switchingId === org.id} disabled={switchingId !== null} onPick={switchTo} />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrgItem({
  org, active, switching, disabled, onPick,
}: {
  org: { id: string; name: string; role: string };
  active: boolean;
  switching: boolean;
  disabled: boolean;
  onPick: (id: string) => Promise<void>;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onClick={() => void onPick(org.id)} className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {switching ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : (
          <Check className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-0")} />
        )}
        <span className="truncate">{org.name}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted">{org.role}</span>
    </DropdownMenuItem>
  );
}
