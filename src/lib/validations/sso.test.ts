import { describe, it, expect } from "vitest";
import {
  ssoGroupMappingSchema,
  ssoSettingsSchema,
  ssoOidcProviderSchema,
  ssoSamlProviderSchema,
} from "./sso";

// ---------------------------------------------------------------------------
// ssoGroupMappingSchema
// ---------------------------------------------------------------------------
describe("ssoGroupMappingSchema", () => {
  const valid = {
    idpGroupName: "Engineering",
    gearflowRole: "admin",
  };

  it("accepts valid minimal data", () => {
    expect(ssoGroupMappingSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts valid complete data with optional fields", () => {
    const result = ssoGroupMappingSchema.safeParse({
      ...valid,
      idpGroupId: "grp-123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing idpGroupName", () => {
    expect(ssoGroupMappingSchema.safeParse({ gearflowRole: "admin" }).success).toBe(false);
  });

  it("rejects empty idpGroupName", () => {
    expect(ssoGroupMappingSchema.safeParse({ ...valid, idpGroupName: "" }).success).toBe(false);
  });

  it("rejects missing gearflowRole", () => {
    expect(ssoGroupMappingSchema.safeParse({ idpGroupName: "Eng" }).success).toBe(false);
  });

  it("rejects empty gearflowRole", () => {
    expect(ssoGroupMappingSchema.safeParse({ ...valid, gearflowRole: "" }).success).toBe(false);
  });

  it("allows omitting idpGroupId", () => {
    const parsed = ssoGroupMappingSchema.parse(valid);
    expect(parsed.idpGroupId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ssoSettingsSchema
// ---------------------------------------------------------------------------
describe("ssoSettingsSchema", () => {
  const validSettings = {
    enabled: true,
    provisioningMode: "AUTO_CREATE" as const,
    defaultRole: "member",
    roleSyncBehavior: "SYNC_ON_LOGIN" as const,
    allowPasswordLogin: true,
    enforceSSO: false,
    ssoTestedSuccessfully: true,
    groupMappings: [],
    oidcGroupsClaim: "groups",
    samlGroupsAttribute: "groups",
    groupValueType: "name" as const,
  };

  it("accepts valid complete data", () => {
    expect(ssoSettingsSchema.safeParse(validSettings).success).toBe(true);
  });

  it("accepts data with group mappings", () => {
    const result = ssoSettingsSchema.safeParse({
      ...validSettings,
      groupMappings: [
        { idpGroupName: "Admins", gearflowRole: "admin" },
        { idpGroupName: "Staff", gearflowRole: "member", idpGroupId: "grp-1" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupMappings).toHaveLength(2);
    }
  });

  // --- required fields ---
  it("rejects missing enabled", () => {
    const { enabled: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing provisioningMode", () => {
    const { provisioningMode: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing defaultRole", () => {
    const { defaultRole: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty defaultRole", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, defaultRole: "" }).success).toBe(false);
  });

  it("rejects missing roleSyncBehavior", () => {
    const { roleSyncBehavior: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing allowPasswordLogin", () => {
    const { allowPasswordLogin: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing enforceSSO", () => {
    const { enforceSSO: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing ssoTestedSuccessfully", () => {
    const { ssoTestedSuccessfully: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing groupMappings", () => {
    const { groupMappings: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing oidcGroupsClaim", () => {
    const { oidcGroupsClaim: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty oidcGroupsClaim", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, oidcGroupsClaim: "" }).success).toBe(false);
  });

  it("rejects missing samlGroupsAttribute", () => {
    const { samlGroupsAttribute: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty samlGroupsAttribute", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, samlGroupsAttribute: "" }).success).toBe(false);
  });

  it("rejects missing groupValueType", () => {
    const { groupValueType: _, ...data } = validSettings;
    expect(ssoSettingsSchema.safeParse(data).success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid provisioningMode", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, provisioningMode: "DENY_ALL" }).success).toBe(false);
  });

  it("accepts all valid provisioningMode values", () => {
    for (const val of ["AUTO_CREATE", "REQUIRE_APPROVAL", "EXISTING_ONLY"]) {
      expect(ssoSettingsSchema.safeParse({ ...validSettings, provisioningMode: val }).success).toBe(true);
    }
  });

  it("rejects invalid roleSyncBehavior", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, roleSyncBehavior: "ALWAYS" }).success).toBe(false);
  });

  it("accepts all valid roleSyncBehavior values", () => {
    for (const val of ["SYNC_ON_LOGIN", "INITIAL_ONLY", "MANUAL_ONLY"]) {
      expect(ssoSettingsSchema.safeParse({ ...validSettings, roleSyncBehavior: val }).success).toBe(true);
    }
  });

  it("rejects invalid groupValueType", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, groupValueType: "email" }).success).toBe(false);
  });

  it("accepts all valid groupValueType values", () => {
    for (const val of ["name", "id"]) {
      expect(ssoSettingsSchema.safeParse({ ...validSettings, groupValueType: val }).success).toBe(true);
    }
  });

  // --- nested schema validation ---
  it("rejects invalid group mapping inside groupMappings array", () => {
    const result = ssoSettingsSchema.safeParse({
      ...validSettings,
      groupMappings: [{ idpGroupName: "", gearflowRole: "admin" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects group mapping missing gearflowRole", () => {
    const result = ssoSettingsSchema.safeParse({
      ...validSettings,
      groupMappings: [{ idpGroupName: "Admins" }],
    });
    expect(result.success).toBe(false);
  });

  // --- boolean fields ---
  it("rejects non-boolean for enabled", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, enabled: "true" }).success).toBe(false);
  });

  it("rejects non-boolean for enforceSSO", () => {
    expect(ssoSettingsSchema.safeParse({ ...validSettings, enforceSSO: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ssoOidcProviderSchema
// ---------------------------------------------------------------------------
describe("ssoOidcProviderSchema", () => {
  const valid = {
    providerId: "oidc-google",
    issuer: "https://accounts.google.com",
    domain: "example.com",
    clientId: "client-abc",
    clientSecret: "secret-xyz",
  };

  it("accepts valid minimal data", () => {
    expect(ssoOidcProviderSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts valid complete data with optional fields", () => {
    const result = ssoOidcProviderSchema.safeParse({
      ...valid,
      scopes: "openid profile email",
      organizationId: "org-123",
    });
    expect(result.success).toBe(true);
  });

  // --- required fields ---
  it("rejects missing providerId", () => {
    const { providerId: _, ...data } = valid;
    expect(ssoOidcProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty providerId", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, providerId: "" }).success).toBe(false);
  });

  it("rejects missing issuer", () => {
    const { issuer: _, ...data } = valid;
    expect(ssoOidcProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects non-URL issuer", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, issuer: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing domain", () => {
    const { domain: _, ...data } = valid;
    expect(ssoOidcProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty domain", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, domain: "" }).success).toBe(false);
  });

  it("rejects missing clientId", () => {
    const { clientId: _, ...data } = valid;
    expect(ssoOidcProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty clientId", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, clientId: "" }).success).toBe(false);
  });

  it("rejects missing clientSecret", () => {
    const { clientSecret: _, ...data } = valid;
    expect(ssoOidcProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty clientSecret", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, clientSecret: "" }).success).toBe(false);
  });

  // --- URL validation ---
  it("accepts HTTPS issuer URL", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, issuer: "https://login.microsoftonline.com/tenant" }).success).toBe(true);
  });

  it("accepts HTTP issuer URL", () => {
    expect(ssoOidcProviderSchema.safeParse({ ...valid, issuer: "http://localhost:8080" }).success).toBe(true);
  });

  // --- optional fields ---
  it("allows omitting scopes", () => {
    const parsed = ssoOidcProviderSchema.parse(valid);
    expect(parsed.scopes).toBeUndefined();
  });

  it("allows omitting organizationId", () => {
    const parsed = ssoOidcProviderSchema.parse(valid);
    expect(parsed.organizationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ssoSamlProviderSchema
// ---------------------------------------------------------------------------
describe("ssoSamlProviderSchema", () => {
  const valid = {
    providerId: "saml-okta",
    issuer: "https://okta.example.com/entity-id",
    domain: "example.com",
    entryPoint: "https://okta.example.com/sso/saml",
    cert: "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA...",
  };

  it("accepts valid minimal data", () => {
    expect(ssoSamlProviderSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts valid complete data with optional fields", () => {
    const result = ssoSamlProviderSchema.safeParse({
      ...valid,
      organizationId: "org-abc",
    });
    expect(result.success).toBe(true);
  });

  // --- required fields ---
  it("rejects missing providerId", () => {
    const { providerId: _, ...data } = valid;
    expect(ssoSamlProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty providerId", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, providerId: "" }).success).toBe(false);
  });

  it("rejects missing issuer", () => {
    const { issuer: _, ...data } = valid;
    expect(ssoSamlProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty issuer", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, issuer: "" }).success).toBe(false);
  });

  it("accepts non-URL issuer (SAML entity ID can be any string)", () => {
    // SAML issuer is min(1), not url() - it's an entity ID
    expect(ssoSamlProviderSchema.safeParse({ ...valid, issuer: "urn:example:saml:entity" }).success).toBe(true);
  });

  it("rejects missing domain", () => {
    const { domain: _, ...data } = valid;
    expect(ssoSamlProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty domain", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, domain: "" }).success).toBe(false);
  });

  it("rejects missing entryPoint", () => {
    const { entryPoint: _, ...data } = valid;
    expect(ssoSamlProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects non-URL entryPoint", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, entryPoint: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing cert", () => {
    const { cert: _, ...data } = valid;
    expect(ssoSamlProviderSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty cert", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, cert: "" }).success).toBe(false);
  });

  // --- optional fields ---
  it("allows omitting organizationId", () => {
    const parsed = ssoSamlProviderSchema.parse(valid);
    expect(parsed.organizationId).toBeUndefined();
  });

  // --- URL validation for entryPoint ---
  it("accepts HTTPS entryPoint URL", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, entryPoint: "https://sso.corp.com/saml" }).success).toBe(true);
  });

  it("accepts HTTP entryPoint URL", () => {
    expect(ssoSamlProviderSchema.safeParse({ ...valid, entryPoint: "http://localhost:8080/saml" }).success).toBe(true);
  });
});
