import { describe, it, expect } from "vitest";
import {
  RESOURCES,
  PERMISSION_REGISTRY,
  rolePermissions,
  hasPermission,
  isReadOnly,
  isBuiltInRole,
  ORG_ROLES,
  ASSIGNABLE_BUILT_IN_ROLES,
  roleLabels,
  type PermissionMap,
  type Resource,
} from "./permissions";

// ─── Constants & registry ───────────────────────────────────────────────────

describe("RESOURCES", () => {
  it("contains all expected resources", () => {
    const expected = [
      "asset", "bulkAsset", "model", "kit", "project", "client",
      "warehouse", "testTag", "maintenance", "location", "document",
      "orgSettings", "orgMembers", "supplier", "subHire", "crew", "reports", "checkItem",
    ];
    expect(RESOURCES).toEqual(expected);
  });

  it("has 18 resources", () => {
    expect(RESOURCES).toHaveLength(18);
  });
});

describe("PERMISSION_REGISTRY", () => {
  it("has an entry for every resource", () => {
    for (const resource of RESOURCES) {
      expect(PERMISSION_REGISTRY[resource]).toBeDefined();
      expect(PERMISSION_REGISTRY[resource].label).toBeTruthy();
      expect(PERMISSION_REGISTRY[resource].actions.length).toBeGreaterThan(0);
    }
  });

  it("every action has a key and label", () => {
    for (const resource of RESOURCES) {
      for (const action of PERMISSION_REGISTRY[resource].actions) {
        expect(action.key).toBeTruthy();
        expect(action.label).toBeTruthy();
      }
    }
  });

  it("action keys are unique within each resource", () => {
    for (const resource of RESOURCES) {
      const keys = PERMISSION_REGISTRY[resource].actions.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

// ─── ORG_ROLES & ASSIGNABLE_BUILT_IN_ROLES ──────────────────────────────────

describe("ORG_ROLES", () => {
  it("lists roles in hierarchy order", () => {
    expect(ORG_ROLES).toEqual(["owner", "admin", "manager", "member", "viewer"]);
  });
});

describe("ASSIGNABLE_BUILT_IN_ROLES", () => {
  it("excludes owner", () => {
    expect(ASSIGNABLE_BUILT_IN_ROLES).not.toContain("owner");
  });

  it("includes admin, manager, member, viewer", () => {
    expect(ASSIGNABLE_BUILT_IN_ROLES).toEqual(["admin", "manager", "member", "viewer"]);
  });
});

describe("roleLabels", () => {
  it("has a label for every built-in role", () => {
    const builtInRoles = ["owner", "admin", "manager", "member", "staff", "warehouse", "viewer"];
    for (const role of builtInRoles) {
      expect(roleLabels[role]).toBeTruthy();
    }
  });

  it("returns expected display names", () => {
    expect(roleLabels.owner).toBe("Owner");
    expect(roleLabels.admin).toBe("Admin");
    expect(roleLabels.manager).toBe("Manager");
    expect(roleLabels.member).toBe("Member");
    expect(roleLabels.staff).toBe("Staff");
    expect(roleLabels.warehouse).toBe("Warehouse");
    expect(roleLabels.viewer).toBe("Viewer");
  });
});

// ─── rolePermissions (built-in roles) ───────────────────────────────────────

describe("rolePermissions", () => {
  it("owner and admin have identical permissions", () => {
    expect(rolePermissions.owner).toEqual(rolePermissions.admin);
  });

  it("owner has all permissions for every resource", () => {
    for (const resource of RESOURCES) {
      const registryActions = PERMISSION_REGISTRY[resource].actions.map((a) => a.key);
      const ownerActions = rolePermissions.owner[resource] as readonly string[];
      expect(ownerActions).toBeDefined();
      for (const action of registryActions) {
        expect(ownerActions).toContain(action);
      }
    }
  });

  it("viewer has only read/view permissions", () => {
    for (const resource of RESOURCES) {
      const viewerActions = rolePermissions.viewer[resource] as readonly string[] | undefined;
      if (viewerActions && viewerActions.length > 0) {
        for (const action of viewerActions) {
          expect(["read", "view"]).toContain(action);
        }
      }
    }
  });

  it("warehouse role has full warehouse access", () => {
    const warehousePerms = rolePermissions.warehouse.warehouse as readonly string[];
    expect(warehousePerms).toContain("read");
    expect(warehousePerms).toContain("check_out");
    expect(warehousePerms).toContain("check_in");
    expect(warehousePerms).toContain("scan");
  });

  it("warehouse role has no document or settings access", () => {
    const docPerms = rolePermissions.warehouse.document as readonly string[];
    const settingsPerms = rolePermissions.warehouse.orgSettings as readonly string[];
    const memberPerms = rolePermissions.warehouse.orgMembers as readonly string[];
    expect(docPerms).toEqual([]);
    expect(settingsPerms).toEqual([]);
    expect(memberPerms).toEqual([]);
  });

  it("manager cannot delete assets", () => {
    const managerAssets = rolePermissions.manager.asset as readonly string[];
    expect(managerAssets).not.toContain("delete");
  });

  it("manager can read org settings but not update", () => {
    const managerSettings = rolePermissions.manager.orgSettings as readonly string[];
    expect(managerSettings).toContain("read");
    expect(managerSettings).not.toContain("update");
  });

  it("member has no org settings or members access", () => {
    const memberSettings = rolePermissions.member.orgSettings as readonly string[];
    const memberMembers = rolePermissions.member.orgMembers as readonly string[];
    expect(memberSettings).toEqual([]);
    expect(memberMembers).toEqual([]);
  });

  it("staff and member have identical permissions", () => {
    expect(rolePermissions.staff).toEqual(rolePermissions.member);
  });

  it("every built-in role covers all 16 resources", () => {
    const builtInRoles = ["owner", "admin", "manager", "member", "staff", "warehouse", "viewer"];
    for (const role of builtInRoles) {
      for (const resource of RESOURCES) {
        expect(rolePermissions[role][resource]).toBeDefined();
      }
    }
  });
});

// ─── hasPermission ──────────────────────────────────────────────────────────

describe("hasPermission", () => {
  describe("owner role", () => {
    it("always returns true regardless of resource or action", () => {
      expect(hasPermission("owner", "asset", "read")).toBe(true);
      expect(hasPermission("owner", "asset", "delete")).toBe(true);
      expect(hasPermission("owner", "orgSettings", "update")).toBe(true);
      expect(hasPermission("owner", "warehouse", "check_out")).toBe(true);
    });

    it("returns true even for non-existent actions (owner safety net)", () => {
      expect(hasPermission("owner", "asset", "nonexistent_action")).toBe(true);
    });
  });

  describe("built-in roles", () => {
    it("admin can create assets", () => {
      expect(hasPermission("admin", "asset", "create")).toBe(true);
    });

    it("viewer cannot create assets", () => {
      expect(hasPermission("viewer", "asset", "create")).toBe(false);
    });

    it("viewer can read assets", () => {
      expect(hasPermission("viewer", "asset", "read")).toBe(true);
    });

    it("warehouse can scan", () => {
      expect(hasPermission("warehouse", "warehouse", "scan")).toBe(true);
    });

    it("warehouse cannot manage templates", () => {
      expect(hasPermission("warehouse", "document", "manage_templates")).toBe(false);
    });

    it("manager can generate documents", () => {
      expect(hasPermission("manager", "project", "generate_documents")).toBe(true);
    });

    it("member can check out from warehouse", () => {
      expect(hasPermission("member", "warehouse", "check_out")).toBe(true);
    });

    it("viewer cannot check out from warehouse", () => {
      expect(hasPermission("viewer", "warehouse", "check_out")).toBe(false);
    });
  });

  describe("unknown built-in role", () => {
    it("returns false for unknown role", () => {
      expect(hasPermission("unknown_role", "asset", "read")).toBe(false);
    });
  });

  describe("custom roles", () => {
    it("returns false when no customPermissions provided", () => {
      expect(hasPermission("custom:abc123", "asset", "read")).toBe(false);
    });

    it("returns false when customPermissions is null", () => {
      expect(hasPermission("custom:abc123", "asset", "read", null)).toBe(false);
    });

    it("returns true when action is in custom permissions", () => {
      const customPerms: PermissionMap = {
        asset: ["read", "create"],
        project: ["read"],
      };
      expect(hasPermission("custom:abc123", "asset", "read", customPerms)).toBe(true);
      expect(hasPermission("custom:abc123", "asset", "create", customPerms)).toBe(true);
    });

    it("returns false when action is NOT in custom permissions", () => {
      const customPerms: PermissionMap = {
        asset: ["read"],
      };
      expect(hasPermission("custom:abc123", "asset", "delete", customPerms)).toBe(false);
    });

    it("returns false when resource is not in custom permissions", () => {
      const customPerms: PermissionMap = {
        asset: ["read"],
      };
      expect(hasPermission("custom:abc123", "project", "read", customPerms)).toBe(false);
    });

    it("handles empty custom permissions", () => {
      const customPerms: PermissionMap = {};
      expect(hasPermission("custom:abc123", "asset", "read", customPerms)).toBe(false);
    });

    it("handles custom permissions with empty action array", () => {
      const customPerms: PermissionMap = { asset: [] };
      expect(hasPermission("custom:abc123", "asset", "read", customPerms)).toBe(false);
    });
  });
});

// ─── isReadOnly ─────────────────────────────────────────────────────────────

describe("isReadOnly", () => {
  it("returns true for viewer permissions", () => {
    expect(isReadOnly(rolePermissions.viewer)).toBe(true);
  });

  it("returns false for owner permissions", () => {
    expect(isReadOnly(rolePermissions.owner)).toBe(false);
  });

  it("returns false for admin permissions", () => {
    expect(isReadOnly(rolePermissions.admin)).toBe(false);
  });

  it("returns false for manager permissions", () => {
    expect(isReadOnly(rolePermissions.manager)).toBe(false);
  });

  it("returns false for member permissions", () => {
    expect(isReadOnly(rolePermissions.member)).toBe(false);
  });

  it("returns false for warehouse permissions (has check_out)", () => {
    expect(isReadOnly(rolePermissions.warehouse)).toBe(false);
  });

  it("returns true for empty permission map", () => {
    expect(isReadOnly({})).toBe(true);
  });

  it("returns true for map with only read actions", () => {
    const perms: PermissionMap = {
      asset: ["read"],
      project: ["read"],
      reports: ["view"],
    };
    expect(isReadOnly(perms)).toBe(true);
  });

  it("returns false if any single write action exists", () => {
    const perms: PermissionMap = {
      asset: ["read"],
      project: ["read", "create"],
    };
    expect(isReadOnly(perms)).toBe(false);
  });

  it("returns true for map with empty action arrays", () => {
    const perms: PermissionMap = {
      asset: [],
      project: [],
    };
    expect(isReadOnly(perms)).toBe(true);
  });
});

// ─── isBuiltInRole ──────────────────────────────────────────────────────────

describe("isBuiltInRole", () => {
  it("returns true for all built-in roles", () => {
    expect(isBuiltInRole("owner")).toBe(true);
    expect(isBuiltInRole("admin")).toBe(true);
    expect(isBuiltInRole("manager")).toBe(true);
    expect(isBuiltInRole("member")).toBe(true);
    expect(isBuiltInRole("staff")).toBe(true);
    expect(isBuiltInRole("warehouse")).toBe(true);
    expect(isBuiltInRole("viewer")).toBe(true);
  });

  it("returns false for custom roles", () => {
    expect(isBuiltInRole("custom:abc123")).toBe(false);
  });

  it("returns false for unknown strings", () => {
    expect(isBuiltInRole("superadmin")).toBe(false);
    expect(isBuiltInRole("")).toBe(false);
    expect(isBuiltInRole("OWNER")).toBe(false);
  });
});
