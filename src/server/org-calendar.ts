"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import type { OrgSettings } from "./settings";

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

async function getSettingsForOrg(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }
  return { org, settings };
}

export async function getOrgIcalSettings() {
  const { organizationId } = await getOrgContext();
  const { settings } = await getSettingsForOrg(organizationId);

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

  const { org, settings } = await getSettingsForOrg(organizationId);

  const token = settings.icalToken || generateToken();
  settings.icalToken = token;
  settings.icalEnabled = true;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: org.name,
    summary: "Enabled organization calendar feeds",
  });

  return serialize({ icalEnabled: true, icalToken: token });
}

export async function disableOrgIcalFeed() {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const { org, settings } = await getSettingsForOrg(organizationId);

  settings.icalEnabled = false;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: org.name,
    summary: "Disabled organization calendar feeds",
  });

  return serialize({ success: true });
}

export async function regenerateOrgIcalToken() {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const { org, settings } = await getSettingsForOrg(organizationId);

  const token = generateToken();
  settings.icalToken = token;
  settings.icalEnabled = true;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: org.name,
    summary: "Regenerated organization calendar feed token",
  });

  return serialize({ icalEnabled: true, icalToken: token });
}
