"use client";

import { useRouter } from "next/navigation";
import { LogOut, User, ChevronsUpDown, Shield, HardHat } from "lucide-react";
import { useSession, signOut, useActiveOrganization } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProfile } from "@/hooks/use-profile";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getMyCrewMemberId } from "@/server/crew";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function UserNav() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const user = session?.user;
  const isSiteAdmin = (user as Record<string, unknown>)?.role === "admin";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Fetch profile for up-to-date avatar (session cookie cache may be stale).
  // Shared store so an account-page avatar/name edit live-updates this nav.
  const { data: profile } = useProfile(user?.id);
  const userImage = profile?.image || user?.image;

  // Check if user has a linked crew profile
  const { data: myCrewId } = useServerQuery({
    queryKey: ["my-crew-id", orgId],
    queryFn: () => getMyCrewMemberId(),
    enabled: !!orgId,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent"
          />
        }
      >
        <UserAvatar
          user={{ name: user?.name, image: userImage }}
          size="sm"
          className="rounded-lg"
        />
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{user?.name || "User"}</span>
          <span className="truncate text-xs text-fg-3">
            {user?.email}
          </span>
        </div>
        <ChevronsUpDown className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56"
        align="end"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-fg-3">{user?.email}</p>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/account")}>
            <User className="mr-2 h-4 w-4" />
            Account Settings
          </DropdownMenuItem>
          {myCrewId && (
            <DropdownMenuItem onClick={() => router.push(`/crew/${myCrewId}`)}>
              <HardHat className="mr-2 h-4 w-4" />
              My Crew Profile
            </DropdownMenuItem>
          )}
          {isSiteAdmin && (
            <DropdownMenuItem onClick={() => router.push("/admin")}>
              <Shield className="mr-2 h-4 w-4" />
              Admin Panel
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={async () => {
              queryClient.clear();
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
