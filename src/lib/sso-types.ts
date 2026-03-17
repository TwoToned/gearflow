export interface SSOGroupMapping {
  idpGroupName: string;
  idpGroupId?: string;
  gearflowRole: string;
  customRoleId?: string;
  /** Set automatically when discovered from IdP during login — not yet mapped to a role */
  unmapped?: boolean;
}

export interface SSOProviderMeta {
  displayName: string;
  icon: string;
}

export interface OrgSSOSettings {
  enabled: boolean;
  provisioningMode: "AUTO_CREATE" | "REQUIRE_APPROVAL" | "EXISTING_ONLY";
  defaultRole: string;
  roleSyncBehavior: "SYNC_ON_LOGIN" | "INITIAL_ONLY" | "MANUAL_ONLY";
  allowPasswordLogin: boolean;
  enforceSSO: boolean;
  ssoTestedSuccessfully: boolean;
  groupMappings: SSOGroupMapping[];
  oidcGroupsClaim: string;
  samlGroupsAttribute: string;
  groupValueType: "name" | "id";
  providerMeta?: Record<string, SSOProviderMeta>;
}

export const DEFAULT_SSO_SETTINGS: OrgSSOSettings = {
  enabled: false,
  provisioningMode: "AUTO_CREATE",
  defaultRole: "member",
  roleSyncBehavior: "SYNC_ON_LOGIN",
  allowPasswordLogin: true,
  enforceSSO: false,
  ssoTestedSuccessfully: false,
  groupMappings: [],
  oidcGroupsClaim: "groups",
  samlGroupsAttribute: "groups",
  groupValueType: "name",
};
