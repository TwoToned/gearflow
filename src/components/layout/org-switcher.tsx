"use client";

import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  useActiveOrganization,
  useListOrganizations,
  organization,
} from "@/lib/auth-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkOrgCreationAllowed } from "@/server/site-admin";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OrgSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const { data: orgPolicy } = useQuery({
    queryKey: ["org-creation-allowed"],
    queryFn: checkOrgCreationAllowed,
  });

  const handleSwitch = async (orgId: string) => {
    await organization.setActive({ organizationId: orgId });
    // Clear all cached data to prevent cross-tenant data leakage
    queryClient.clear();
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-2" />}
      >
        <Building2 className="h-4 w-4" />
        <span className="hidden sm:inline-block max-w-[150px] truncate">
          {activeOrg?.name || "Select Organization"}
        </span>
        <ChevronsUpDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {orgs?.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className="gap-2"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold">
                {org.name.charAt(0).toUpperCase()}
              </div>
              <span className="flex-1 truncate">{org.name}</span>
              {activeOrg?.id === org.id && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {orgPolicy?.allowed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => router.push("/onboarding")}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                <span>New Organization</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
