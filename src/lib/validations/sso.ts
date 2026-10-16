import { z } from "zod";

export const ssoGroupMappingSchema = z.object({
  idpGroupName: z.string().min(1, "Group name is required"),
  idpGroupId: z.string().optional(),
  gearflowRole: z.string().min(1, "Role is required"),
});

export const ssoSettingsSchema = z.object({
  enabled: z.boolean(),
  provisioningMode: z.enum(["AUTO_CREATE", "REQUIRE_APPROVAL", "EXISTING_ONLY"]),
  defaultRole: z.string().min(1),
  roleSyncBehavior: z.enum(["SYNC_ON_LOGIN", "INITIAL_ONLY", "MANUAL_ONLY"]),
  allowPasswordLogin: z.boolean(),
  enforceSSO: z.boolean(),
  ssoTestedSuccessfully: z.boolean(),
  groupMappings: z.array(ssoGroupMappingSchema),
  oidcGroupsClaim: z.string().min(1),
  samlGroupsAttribute: z.string().min(1),
  groupValueType: z.enum(["name", "id"]),
});

export const ssoOidcProviderSchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  issuer: z.string().url("Must be a valid URL"),
  domain: z.string().min(1, "Domain is required"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  scopes: z.string().optional(),
  organizationId: z.string().optional(),
});

/**
 * Patch of an existing OIDC provider's stored config. Credentials are rotated
 * here rather than through Better Auth's update-provider, which refuses any
 * `clientId` change once a user has linked an account to the provider.
 */
export const ssoOidcConfigPatchSchema = z.object({
  useIdTokenOnly: z.boolean().optional(),
  clientId: ssoOidcProviderSchema.shape.clientId.optional(),
  clientSecret: ssoOidcProviderSchema.shape.clientSecret.optional(),
});

export type SsoOidcConfigPatch = z.infer<typeof ssoOidcConfigPatchSchema>;

export const ssoSamlProviderSchema = z.object({
  providerId: z.string().min(1, "Provider ID is required"),
  issuer: z.string().min(1, "Entity ID is required"),
  domain: z.string().min(1, "Domain is required"),
  entryPoint: z.string().url("Must be a valid URL"),
  cert: z.string().min(1, "Certificate is required"),
  organizationId: z.string().optional(),
});

export type SSOSettingsFormValues = z.input<typeof ssoSettingsSchema>;
export type SSOGroupMappingFormValues = z.input<typeof ssoGroupMappingSchema>;
export type SSOOidcProviderFormValues = z.input<typeof ssoOidcProviderSchema>;
export type SSOSamlProviderFormValues = z.input<typeof ssoSamlProviderSchema>;
