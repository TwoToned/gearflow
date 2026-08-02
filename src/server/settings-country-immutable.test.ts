/**
 * src/server/settings.ts's updateOrganization — M6 (#1079, I1): a set org
 * country is immutable after creation. Enforced server-side by forcing the
 * persisted value back onto the patch, the same "strip on the server"
 * posture as PROJECT_UPDATE_IMMUTABLE (convex/projectWrites.ts) — a client
 * that sends a different `settings.country` must be silently overridden,
 * not merely blocked by a disabled input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/org-context", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const organizationUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { update: (...a: unknown[]) => organizationUpdate(...a) },
  },
}));

const readOrgSettingsBlob = vi.fn();
const saveOrgSettings = vi.fn();
vi.mock("@/lib/org-settings-read", () => ({
  readOrgSettingsBlob: (...a: unknown[]) => readOrgSettingsBlob(...a),
  saveOrgSettings: (...a: unknown[]) => saveOrgSettings(...a),
}));

vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import { updateOrganization } from "./settings";

const ACTOR = { organizationId: "org_A", userId: "user_owner", userName: "Owner" };

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ACTOR);
  organizationUpdate.mockResolvedValue({ id: "org_A", name: "Acme" });
  saveOrgSettings.mockResolvedValue(undefined);
});

describe("updateOrganization — country immutable after creation (M6)", () => {
  it("accepts the country on the first save (previously unset)", async () => {
    readOrgSettingsBlob.mockResolvedValue({});

    await updateOrganization({ name: "Acme", settings: { country: "AU" } });

    expect(saveOrgSettings).toHaveBeenCalledWith("org_A", { country: "AU" }, undefined);
  });

  it("silently forces a changed country back to the existing value once set", async () => {
    readOrgSettingsBlob.mockResolvedValue({ country: "AU" });

    await updateOrganization({ name: "Acme", settings: { country: "US", phone: "555" } });

    expect(saveOrgSettings).toHaveBeenCalledWith(
      "org_A",
      { country: "AU", phone: "555" },
      undefined,
    );
  });

  it("leaves other settings fields untouched when the country is already set and unchanged", async () => {
    readOrgSettingsBlob.mockResolvedValue({ country: "GB" });

    await updateOrganization({ name: "Acme", settings: { country: "GB", website: "acme.test" } });

    expect(saveOrgSettings).toHaveBeenCalledWith(
      "org_A",
      { country: "GB", website: "acme.test" },
      undefined,
    );
  });
});
