"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signOut, organization } from "@/lib/auth-client";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2, LogOut, Loader2, Shield, Plus } from "lucide-react";
import { toast } from "sonner";
import { getMyPendingInvitations, checkIsSiteAdmin } from "@/server/invitations";
import { checkOrgCreationAllowed } from "@/server/site-admin";

export default function NoOrganizationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { name: platformName, icon: platformIcon } = usePlatformBranding();

  const { data: invitations, isLoading } = useQuery({
    queryKey: ["my-pending-invitations"],
    queryFn: getMyPendingInvitations,
    refetchInterval: 30_000,
  });

  const { data: isSiteAdmin } = useQuery({
    queryKey: ["is-site-admin"],
    queryFn: checkIsSiteAdmin,
  });

  const { data: orgPolicy } = useQuery({
    queryKey: ["org-creation-allowed"],
    queryFn: checkOrgCreationAllowed,
  });

  const acceptMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await organization.acceptInvitation({ invitationId });
      if (res.error) throw new Error(res.error.message || "Failed to accept invitation");
      return res;
    },
    onSuccess: async () => {
      toast.success("Invitation accepted!");
      // Set the org as active and go to dashboard
      const orgs = await fetch("/api/auth/organization/list", { credentials: "include" }).then(r => r.json());
      if (orgs?.length > 0) {
        await organization.setActive({ organizationId: orgs[orgs.length - 1].id });
      }
      queryClient.invalidateQueries({ queryKey: ["my-pending-invitations"] });
      router.push("/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {platformIcon ? (
            <DynamicIcon name={platformIcon} className="h-5 w-5" />
          ) : (
            <Building2 className="h-5 w-5" />
          )}
        </div>
        <CardTitle className="text-xl">No Organization</CardTitle>
        <CardDescription>
          You don&apos;t belong to any organizations on {platformName}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-4">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : invitations && invitations.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-center">Pending Invitations</p>
            {invitations.map((inv: { id: string; organization: { id: string; name: string }; role?: string | null }) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10 text-primary text-xs font-bold">
                    {inv.organization.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.organization.name}</p>
                    {inv.role && (
                      <p className="text-xs text-muted-foreground capitalize">as {inv.role}</p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={acceptMutation.isPending}
                  onClick={() => acceptMutation.mutate(inv.id)}
                >
                  {acceptMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Join"
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            Contact an administrator to be invited to an organization.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {orgPolicy?.allowed && (
          <Button
            className="w-full"
            onClick={() => router.push("/onboarding")}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </Button>
        )}
        {isSiteAdmin && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.push("/admin")}
          >
            <Shield className="mr-2 h-4 w-4" />
            Admin Panel
          </Button>
        )}
        <Button
          variant="ghost"
          className="w-full"
          onClick={async () => {
            await signOut();
            router.push("/login");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}
