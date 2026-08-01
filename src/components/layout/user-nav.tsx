"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User, ChevronsUpDown, Shield, HardHat, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSiteAdminRole } from "@/lib/admin-role";
import { useSession, signOut, useActiveOrganization, organization } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProfile } from "@/hooks/use-profile";
import { getMyOrganizations } from "@/server/public-org";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export function UserNav() {
  const router = useRouter();
  const { data: session } = useSession();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  const user = session?.user;
  const isSiteAdmin = isSiteAdminRole(
    (user as { role?: string } | undefined)?.role,
  );
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Fetch profile for up-to-date avatar (session cookie cache may be stale).
  // Shared store so an account-page avatar/name edit live-updates this nav.
  const { data: profile } = useProfile(user?.id);
  const userImage = profile?.image || user?.image;

  // Check if user has a linked crew profile
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: myCrewId } = useServerQuery({
    queryKey: ["my-crew-id", orgId, isAuthenticated],
    queryFn: () => convex.query(api.crew.myCrewMemberId, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  // Org switcher (design doc §4.3.1, A2) — membership-derived, never a client-
  // filtered list of all orgs. Shown only when there are ≥2 memberships; the
  // active org's name still fills the trigger's second line for everyone,
  // since that's context, not the switcher UI itself.
  const { data: myOrgs } = useServerQuery({
    queryKey: ["my-organizations", user?.id],
    queryFn: () => getMyOrganizations(),
    enabled: !!user?.id,
  });
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function switchOrganization(targetOrgId: string) {
    if (targetOrgId === orgId || switchingId) return;
    setSwitchingId(targetOrgId);
    try {
      await organization.setActive({ organizationId: targetOrgId });
      // Always land on a tenant-neutral root — never carry an id belonging to
      // the previous org into the newly-activated one (design doc §4.3.1). The
      // Convex client re-authenticates for free (src/components/providers/
      // convex-provider.tsx reacts to the orgId change), so nothing else here
      // needs to force a token refresh or drop a cache.
      router.push("/dashboard");
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "flex w-full cursor-pointer items-center rounded-[var(--r)] transition-colors hover:bg-elev data-[state=open]:bg-elev",
            FOCUS,
            collapsed ? "justify-center py-1.5" : "gap-2.5 px-2 py-2",
          )}
        >
          <UserAvatar
            user={{ name: user?.name, image: userImage }}
            size="sm"
            className="rounded-lg"
          />
          {!collapsed && (
            <>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-medium text-ink">{user?.name || "User"}</span>
                <span className="truncate text-[11px] text-muted">
                  {activeOrg?.name ?? user?.email}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56"
        align={collapsed ? "end" : "start"}
        side={collapsed ? "right" : "top"}
        sideOffset={collapsed ? 8 : 4}
      >
        {myOrgs && myOrgs.length >= 2 && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal text-[11px] text-muted">
                Organisations
              </DropdownMenuLabel>
              {myOrgs.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  disabled={switchingId !== null}
                  onClick={() => switchOrganization(org.id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {switchingId === org.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          org.id === orgId ? "opacity-100" : "opacity-0",
                        )}
                      />
                    )}
                    <span className="truncate">{org.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{org.role}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-[13px] font-medium text-ink">{user?.name}</p>
              <p className="text-[11px] text-muted">{user?.email}</p>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/account")}>
            <User className="mr-2 h-4 w-4" />
            Account settings
          </DropdownMenuItem>
          {myCrewId && (
            <DropdownMenuItem onClick={() => router.push(`/crew/${myCrewId}`)}>
              <HardHat className="mr-2 h-4 w-4" />
              My crew profile
            </DropdownMenuItem>
          )}
          {isSiteAdmin && (
            <DropdownMenuItem onClick={() => router.push("/admin")}>
              <Shield className="mr-2 h-4 w-4" />
              Admin panel
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={async () => {
              await signOut();
              router.push("/login");
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
