"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCanDo } from "@/lib/use-permissions";
import { getSSOSettings, updateSSOSettings, getSSOProviders } from "@/server/sso";
import { SSOStatusSection } from "@/components/settings/sso-status";
import { SSOProviderSection } from "@/components/settings/sso-providers";
import { SSOProvisioningSection } from "@/components/settings/sso-provisioning";
import { SSOGroupMappingSection } from "@/components/settings/sso-group-mapping";
import { SSOLoginBehaviorSection } from "@/components/settings/sso-login-behavior";
import { SSOPendingApprovals } from "@/components/settings/sso-pending-approvals";
import { FormSection } from "@/components/layout/page-layouts";
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
        <div className="h-32 animate-pulse rounded-lg bg-bg-surface" />
        <div className="h-48 animate-pulse rounded-lg bg-bg-surface" />
      </div>
    );
  }

  const sso = data?.sso;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">
          <FormSection
            title="Single Sign-On"
            description="Configure SSO with your identity provider for secure, centralized authentication."
          >
            <div className="sm:col-span-2">
              <SSOStatusSection
                enabled={sso?.enabled ?? false}
                canUpdate={canUpdate}
                onToggle={(enabled) => updateMutation.mutate({ enabled })}
              />
            </div>
          </FormSection>

          <FormSection
            title="Identity Providers"
            description="Configure SAML 2.0 or OIDC providers for your organization."
          >
            <div className="sm:col-span-2">
              <SSOProviderSection
                providers={providers || []}
                loading={providersLoading}
                canUpdate={canUpdate}
                providerMeta={sso?.providerMeta}
              />
            </div>
          </FormSection>
        </div>
      </div>

      {sso?.enabled && (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="space-y-6">
            <FormSection
              title="User Provisioning"
              description="Control how new users are added when they sign in via SSO."
            >
              <div className="sm:col-span-2">
                <SSOProvisioningSection
                  provisioningMode={sso.provisioningMode}
                  defaultRole={sso.defaultRole}
                  canUpdate={canUpdate}
                  onUpdate={(updates) => updateMutation.mutate(updates)}
                />
              </div>
            </FormSection>

            <FormSection
              title="Group-to-Role Mapping"
              description="Map identity provider groups to GearFlow roles."
            >
              <div className="sm:col-span-2">
                <SSOGroupMappingSection
                  mappings={sso.groupMappings || []}
                  roleSyncBehavior={sso.roleSyncBehavior}
                  oidcGroupsClaim={sso.oidcGroupsClaim}
                  samlGroupsAttribute={sso.samlGroupsAttribute}
                  groupValueType={sso.groupValueType}
                  canUpdate={canUpdate}
                />
              </div>
            </FormSection>

            <FormSection
              title="Login Behaviour"
              description="Control which authentication methods are available."
            >
              <div className="sm:col-span-2">
                <SSOLoginBehaviorSection
                  allowPasswordLogin={sso.allowPasswordLogin}
                  enforceSSO={sso.enforceSSO}
                  ssoTestedSuccessfully={sso.ssoTestedSuccessfully}
                  canUpdate={canUpdate}
                  onUpdate={(updates) => updateMutation.mutate(updates)}
                />
              </div>
            </FormSection>

            {sso.provisioningMode === "REQUIRE_APPROVAL" && (
              <FormSection
                title="Pending Approvals"
                description="Review and approve users who signed in via SSO."
              >
                <div className="sm:col-span-2">
                  <SSOPendingApprovals />
                </div>
              </FormSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
