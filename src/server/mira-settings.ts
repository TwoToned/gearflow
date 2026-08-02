"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/crypto/secret-vault";
import { miraSettingsSchema, type MiraSettingsFormValues } from "@/lib/validations/mira-settings";

/**
 * Org-admin settings for Mira's LLM tool-calling (`/settings/mira`, gated on
 * `orgSettings:update` like every other integration-settings save — see
 * FEATUREDOCS/68). Each org supplies its OWN OpenRouter API key (encrypted at
 * rest via src/lib/crypto/secret-vault.ts, the same vault protecting Xero's
 * refresh token) and picks its own model string; the platform never sees or
 * pays for a shared LLM credential.
 *
 * `writeAccessEnabled` gates whether Mira's self-provisioned key
 * (src/server/mira.ts) uses the read-only or full_agent preset — flipping it
 * revokes every already-provisioned miraKeys row for the org (see
 * convex/miraOrgSettings.ts `patch`), so the change takes effect on the very
 * next question, not just for new members.
 */

interface MiraSettingsView {
  hasApiKey: boolean;
  model: string;
  writeAccessEnabled: boolean;
  updatedAt: number | null;
}

/**
 * Whether Mira is usable AT ALL for the current org — no permission gate
 * (unlike `getMiraSettings`, which needs `orgSettings:read` and most
 * non-admin roles don't have it: `member`/`warehouse`/`viewer` all get
 * `orgSettings: []`). Every member needs to be able to check this so the
 * launcher can hide itself when an org hasn't configured Mira, without
 * requiring org-settings access just to know that. Reveals nothing beyond a
 * boolean — never the key, model, or write-access setting.
 */
export async function isMiraConfigured(): Promise<{ configured: boolean }> {
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraOrgSettings.getForOrg, { organizationId });
  return serialize({ configured: !!existing?.openRouterKeyEncrypted });
}

export async function getMiraSettings(): Promise<MiraSettingsView> {
  const { organizationId } = await requirePermission("orgSettings", "read");
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraOrgSettings.getForOrg, { organizationId });
  return serialize({
    hasApiKey: !!existing?.openRouterKeyEncrypted,
    model: existing?.model ?? "",
    writeAccessEnabled: existing?.writeAccessEnabled ?? false,
    updatedAt: existing?.updatedAt ?? null,
  });
}

export async function saveMiraSettings(data: MiraSettingsFormValues): Promise<MiraSettingsView> {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const parsed = miraSettingsSchema.parse(data);

  const convex = await getConvexClient();
  const existing = await convex.query(api.miraOrgSettings.getForOrg, { organizationId });
  const now = Date.now();

  const keyChanged = !!parsed.openRouterApiKey;
  const accessChanged = existing != null && parsed.writeAccessEnabled !== existing.writeAccessEnabled;

  if (existing) {
    await convex.mutation(api.miraOrgSettings.patch, {
      id: existing.id,
      organizationId,
      openRouterKeyEncrypted: keyChanged ? encryptSecret(parsed.openRouterApiKey!) : undefined,
      model: parsed.model,
      writeAccessEnabled: parsed.writeAccessEnabled,
      updatedById: userId,
    });
  } else {
    await convex.mutation(api.miraOrgSettings.create, {
      id: createId(),
      organizationId,
      openRouterKeyEncrypted: keyChanged ? encryptSecret(parsed.openRouterApiKey!) : undefined,
      model: parsed.model,
      writeAccessEnabled: parsed.writeAccessEnabled,
      updatedAt: now,
      updatedById: userId,
    });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "miraSettings",
    entityId: organizationId,
    entityName: "Mira AI assistant",
    summary:
      "Updated Mira AI assistant settings" +
      (keyChanged ? " (OpenRouter key changed)" : "") +
      (accessChanged ? ` (write access ${parsed.writeAccessEnabled ? "enabled" : "disabled"})` : ""),
  });

  return getMiraSettings();
}

export async function disconnectMiraOpenRouter(): Promise<MiraSettingsView> {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraOrgSettings.getForOrg, { organizationId });
  if (existing) {
    await convex.mutation(api.miraOrgSettings.disconnectOpenRouter, {
      id: existing.id,
      organizationId,
      updatedById: userId,
    });
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "miraSettings",
      entityId: organizationId,
      entityName: "Mira AI assistant",
      summary: "Disconnected Mira's OpenRouter API key",
    });
  }
  return getMiraSettings();
}
