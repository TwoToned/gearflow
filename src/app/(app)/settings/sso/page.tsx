"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCanDo } from "@/lib/use-permissions";
import { getSSOSettings, updateSSOSettings, getSSOProviders } from "@/server/sso";
import { SSOStatusSection } from "@/components/settings/sso-status";
import { SSOProviderSection } from "@/components/settings/sso-providers";
import { SSOProvisioningSection } from "@/components/settings/sso-provisioning";
import { SSOGroupMappingSection } from "@/components/settings/sso-group-mapping";
import { SSOLoginBehaviorSection } from "@/components/settings/sso-login-behavior";
import { SSOPendingApprovals } from "@/components/settings/sso-pending-approvals";
import type { OrgSSOSettings } from "@/lib/sso-types";
import { toast } from "sonner";

export default function SSOSettingsPage() {
  const canUpdate = useCanDo("orgSettings", "update");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["sso-settings"],
    queryFn: () => getSSOSettings(),
  });

  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ["sso-providers"],
    queryFn: () => getSSOProviders(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<OrgSSOSettings>) => updateSSOSettings(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso-settings"] });
      toast.success("SSO settings updated");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update settings");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const sso = data?.sso;
  const orgSlug = data?.orgSlug;

  return (
    <div className="space-y-6">
      {/* Section 1: SSO Status */}
      <Card>
        <CardHeader>
          <CardTitle>Single Sign-On</CardTitle>
          <CardDescription>
            Configure SSO with your identity provider for secure, centralized authentication.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SSOStatusSection
            enabled={sso?.enabled ?? false}
            canUpdate={canUpdate}
            onToggle={(enabled) => updateMutation.mutate({ enabled })}
          />
        </CardContent>
      </Card>

      {/* Section 2: Identity Providers */}
      <Card>
        <CardHeader>
          <CardTitle>Identity Providers</CardTitle>
          <CardDescription>
            Configure SAML 2.0 or OIDC providers for your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SSOProviderSection
            providers={providers || []}
            loading={providersLoading}
            canUpdate={canUpdate}
            providerMeta={sso?.providerMeta}
          />
        </CardContent>
      </Card>

      {/* Section 3: User Provisioning */}
      {sso?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>User Provisioning</CardTitle>
            <CardDescription>
              Control how new users are added when they sign in via SSO.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SSOProvisioningSection
              provisioningMode={sso.provisioningMode}
              defaultRole={sso.defaultRole}
              canUpdate={canUpdate}
              onUpdate={(updates) => updateMutation.mutate(updates)}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 4: Group-to-Role Mapping */}
      {sso?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Group-to-Role Mapping</CardTitle>
            <CardDescription>
              Map identity provider groups to GearFlow roles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SSOGroupMappingSection
              mappings={sso.groupMappings || []}
              roleSyncBehavior={sso.roleSyncBehavior}
              oidcGroupsClaim={sso.oidcGroupsClaim}
              samlGroupsAttribute={sso.samlGroupsAttribute}
              groupValueType={sso.groupValueType}
              canUpdate={canUpdate}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 5: Login Behaviour */}
      {sso?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Login Behaviour</CardTitle>
            <CardDescription>
              Control which authentication methods are available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SSOLoginBehaviorSection
              allowPasswordLogin={sso.allowPasswordLogin}
              enforceSSO={sso.enforceSSO}
              ssoTestedSuccessfully={sso.ssoTestedSuccessfully}
              canUpdate={canUpdate}
              onUpdate={(updates) => updateMutation.mutate(updates)}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 6: Pending Approvals */}
      {sso?.enabled && sso.provisioningMode === "REQUIRE_APPROVAL" && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Approvals</CardTitle>
            <CardDescription>
              Review and approve users who signed in via SSO.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SSOPendingApprovals />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
