"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { BottomSheet, BottomSheetItem, BottomSheetSeparator } from "@/components/ui/bottom-sheet";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useNavItems } from "@/hooks/use-nav-items";
import { useOrgSwitch } from "@/hooks/use-org-switch";
import { useProfile } from "@/hooks/use-profile";
import { useSession, signOut } from "@/lib/auth-client";
import { moreSheetGroups, type MoreRow } from "@/lib/nav";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { ThemeWords } from "@/components/layout/theme-words";

type Drill = { kind: "row"; row: MoreRow } | { kind: "org" } | null;

/** Name, avatar and the one muted line (active org, else email) for the head. */
function useUserFace() {
  const { data: session } = useSession();
  const { activeOrgName } = useOrgSwitch();
  const user = session?.user;
  const { data: profile } = useProfile(user?.id);
  return {
    name: user?.name || "Account",
    image: profile?.image || user?.image,
    sub: activeOrgName ?? user?.email,
  };
}

function UserHead({ onDrillOrg, showOrg }: { onDrillOrg: () => void; showOrg: boolean }) {
  const router = useRouter();
  const face = useUserFace();
  return (
    <div className="flex flex-col">
      <BottomSheetItem
        onSelect={() => router.push("/account")}
        icon={<UserAvatar user={{ name: face.name, image: face.image }} size="sm" className="rounded-lg" />}
        trailing={<ChevronRight className="size-4 text-muted" />}
        className="min-h-14"
      >
        <span className="grid leading-tight">
          <span className="truncate text-[14px] font-medium text-ink">{face.name}</span>
          <span className="truncate text-[12px] text-muted">{face.sub}</span>
        </span>
      </BottomSheetItem>
      {showOrg && (
        <BottomSheetItem keepOpen onSelect={onDrillOrg} trailing={<ChevronRight className="size-4 text-muted" />}>
          Organisation
        </BottomSheetItem>
      )}
      <div className="flex min-h-12 items-center justify-between px-4">
        <ThemeWords />
      </div>
      <BottomSheetItem
        danger
        icon={<LogOut />}
        onSelect={async () => {
          await signOut();
          router.push("/login");
        }}
      >
        Sign out
      </BottomSheetItem>
    </div>
  );
}

function RowItem({ row, onDrill }: { row: MoreRow; onDrill: (row: MoreRow) => void }) {
  const router = useRouter();
  const Icon = NAV_ICONS[row.icon];
  const drillable = row.subs.length > 0;
  return (
    <BottomSheetItem
      keepOpen={drillable}
      icon={<Icon />}
      trailing={drillable ? <ChevronRight className="size-4 text-muted" /> : undefined}
      onSelect={() => (drillable ? onDrill(row) : router.push(row.url))}
    >
      {row.label}
    </BottomSheetItem>
  );
}

function DrillHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-[14px] font-medium text-ink">
      <ChevronLeft className="size-4 text-muted" aria-hidden /> {title}
    </button>
  );
}

function RowDrill({ row, onBack }: { row: MoreRow; onBack: () => void }) {
  const router = useRouter();
  const Icon = NAV_ICONS[row.icon];
  return (
    <>
      <DrillHeader title={row.label} onBack={onBack} />
      <BottomSheetSeparator />
      <BottomSheetItem icon={<Icon />} onSelect={() => router.push(row.url)}>
        Open {row.label}
      </BottomSheetItem>
      {row.subs.map((s) => {
        const SubIcon = NAV_ICONS[s.icon];
        return (
          <BottomSheetItem key={s.key} icon={<SubIcon />} onSelect={() => router.push(s.url)}>
            {s.label}
          </BottomSheetItem>
        );
      })}
    </>
  );
}

function OrgDrill({ onBack }: { onBack: () => void }) {
  const { orgs, activeOrgId, switchTo } = useOrgSwitch();
  return (
    <>
      <DrillHeader title="Organisation" onBack={onBack} />
      <BottomSheetSeparator />
      {orgs.map((o) => (
        <BottomSheetItem
          key={o.id}
          icon={o.id === activeOrgId ? <Check /> : <span />}
          trailing={<span className="text-[11px] text-muted">{o.role}</span>}
          onSelect={() => void switchTo(o.id)}
        >
          {o.name}
        </BottomSheetItem>
      ))}
    </>
  );
}

function MoreGroups({ onDrill }: { onDrill: (row: MoreRow) => void }) {
  const { all } = useNavItems();
  const groups = useMemo(() => moreSheetGroups(all), [all]);
  return (
    <>
      {groups.map((g) => (
        <section key={g.group} aria-label={g.label}>
          <BottomSheetSeparator />
          <h3 className="t-overline px-4 pb-1 pt-2 text-muted">{g.label}</h3>
          {g.rows.map((row) => (
            <RowItem key={row.key} row={row} onDrill={onDrill} />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * The phone More sheet (§6d.6, D65): 88%, 48 px rows, the user head (account,
 * Organisation ›, Theme, Sign out), then Plan / Crew and gear / People / Account
 * from the one NAV table. `›` rows drill to `Open X` + sub-pages. Replaces the
 * hamburger drawer.
 */
export function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [drill, setDrill] = useState<Drill>(null);
  const { orgs } = useOrgSwitch();
  const handleOpenChange = (o: boolean) => {
    if (!o) setDrill(null);
    onOpenChange(o);
  };
  const back = () => setDrill(null);

  return (
    <BottomSheet open={open} onOpenChange={handleOpenChange} title="More" className="h-[88dvh] max-h-[88dvh]">
      {drill?.kind === "row" && <RowDrill row={drill.row} onBack={back} />}
      {drill?.kind === "org" && <OrgDrill onBack={back} />}
      {!drill && (
        <>
          <UserHead showOrg={orgs.length >= 2} onDrillOrg={() => setDrill({ kind: "org" })} />
          <MoreGroups onDrill={(row) => setDrill({ kind: "row", row })} />
        </>
      )}
    </BottomSheet>
  );
}
