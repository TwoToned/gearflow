"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { SEED_PROFILES } from "@/lib/test-profiles/seed-data";

/**
 * Browser-direct TEST-PROFILE writes (Phase 3 — replaces the test-tag-profiles.ts
 * server actions). Test profiles are Convex-only config; each guarded
 * `api.testProfilesWrites.*` mutation runs the 4 guards + org re-check + unique-name
 * guard + audit. Seed reads the static SEED_PROFILES (client-minted ids) and lets the
 * mutation dedup by name server-side. Delete soft-deactivates when still referenced.
 */
export interface TestProfileInput {
  name: string;
  equipmentClass?: string;
  applianceType?: string;
  visualChecks: unknown[];
  electricalTests: unknown[];
  thresholds: Record<string, unknown>;
  requiresSubTests?: boolean;
  defaultSubTestCount?: number;
  subTestLabel?: string;
  isActive?: boolean;
}

export function useTestProfileWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.testProfilesWrites.createNative);
  const updateM = useMutation(api.testProfilesWrites.updateNative);
  const duplicateM = useMutation(api.testProfilesWrites.duplicateNative);
  const seedM = useMutation(api.testProfilesWrites.seedDefaultsNative);
  const removeM = useMutation(api.testProfilesWrites.deleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    createProfile: async (data: TestProfileInput): Promise<{ id: string }> =>
      createM({
        id: createId(), orgId: requireOrg(), name: data.name,
        equipmentClass: data.equipmentClass, applianceType: data.applianceType,
        visualChecks: data.visualChecks, electricalTests: data.electricalTests, thresholds: data.thresholds,
        requiresSubTests: data.requiresSubTests, defaultSubTestCount: data.defaultSubTestCount, subTestLabel: data.subTestLabel,
        now: Date.now(), actor: actor(), auditId: createId(),
      }),
    updateProfile: async (id: string, data: Partial<TestProfileInput>): Promise<{ id: string }> =>
      updateM({
        id, orgId: requireOrg(), name: data.name,
        equipmentClass: data.equipmentClass, applianceType: data.applianceType,
        visualChecks: data.visualChecks, electricalTests: data.electricalTests, thresholds: data.thresholds,
        requiresSubTests: data.requiresSubTests, defaultSubTestCount: data.defaultSubTestCount, subTestLabel: data.subTestLabel, isActive: data.isActive,
        now: Date.now(), actor: actor(), auditId: createId(),
      }),
    duplicateProfile: async (id: string): Promise<{ id: string; name: string }> =>
      duplicateM({ id, newId: createId(), orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
    seedDefaultProfiles: async (): Promise<{ created: number }> =>
      seedM({
        orgId: requireOrg(),
        profiles: SEED_PROFILES.map((p) => ({ id: createId(), ...p })),
        now: Date.now(), actor: actor(), auditId: createId(),
      }),
    deleteProfile: async (id: string): Promise<{ id: string; deactivated: boolean }> =>
      removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
  };
}
