"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { readOrgSettingsBlob, saveOrgSettings } from "@/lib/org-settings-read";

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Org name for the activity log (identity stays on the Better Auth org row).
async function getOrgName(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!org) throw new Error("Organization not found");
  return org.name;
}

export async function getOrgIcalSettings() {
  const { organizationId } = await getOrgContext();
  const settings = await readOrgSettingsBlob(organizationId);

  return serialize({
    icalEnabled: settings.icalEnabled || false,
    icalToken: settings.icalToken || null,
  });
}

export async function enableOrgIcalFeed() {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const settings = await readOrgSettingsBlob(organizationId);

  const token = settings.icalToken || generateToken();
  settings.icalToken = token;
  settings.icalEnabled = true;
  await saveOrgSettings(organizationId, settings);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: await getOrgName(organizationId),
    summary: "Enabled organization calendar feeds",
  });

  return serialize({ icalEnabled: true, icalToken: token });
}

export async function disableOrgIcalFeed() {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const settings = await readOrgSettingsBlob(organizationId);

  settings.icalEnabled = false;
  await saveOrgSettings(organizationId, settings);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: await getOrgName(organizationId),
    summary: "Disabled organization calendar feeds",
  });

  return serialize({ success: true });
}

export async function regenerateOrgIcalToken() {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const settings = await readOrgSettingsBlob(organizationId);

  const token = generateToken();
  settings.icalToken = token;
  settings.icalEnabled = true;
  await saveOrgSettings(organizationId, settings);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: await getOrgName(organizationId),
    summary: "Regenerated organization calendar feed token",
  });

  return serialize({ icalEnabled: true, icalToken: token });
}
