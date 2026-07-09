"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { generateWebhookSecret } from "@/lib/webhooks/sign";
import { validateWebhookUrl } from "@/lib/webhooks/url";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS, isWebhookEvent } from "@/lib/webhooks/events";
import { UserFacingError } from "@/lib/errors";

/**
 * Webhook endpoint management. Creating, rotating and deleting an endpoint are
 * `orgSettings:update` writes, and the whole module is marked `dangerous` in the API
 * registry — so an API key needs an explicit scope AND `confirm` + `idempotencyKey`.
 * An agent must not be able to quietly point your events at its own URL.
 *
 * See docs/designs/webhooks.md.
 */

const READ_SHAPE = {
  id: true,
  description: true,
  url: true,
  events: true,
  isActive: true,
  disabledAt: true,
  consecutiveFailures: true,
  lastDeliveryAt: true,
  createdAt: true,
} as const;

/** The events an endpoint can subscribe to, with descriptions. Read-only. */
export async function getWebhookEvents() {
  await getOrgContext();
  return serialize({
    events: WEBHOOK_EVENTS.map((event) => ({
      event,
      description: WEBHOOK_EVENT_DESCRIPTIONS[event],
    })),
  });
}

/** List this org's endpoints. Never returns a secret. */
export async function getWebhooks() {
  const { organizationId } = await getOrgContext();
  const webhooks = await prisma.webhook.findMany({
    where: { organizationId },
    select: READ_SHAPE,
    orderBy: { createdAt: "desc" },
  });
  return serialize({ webhooks });
}

/** Recent delivery attempts for one endpoint — the self-serve debugging surface. */
export async function getWebhookDeliveries(webhookId: string, limit?: number) {
  const { organizationId } = await getOrgContext();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId, organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit ?? 50, 200),
    select: {
      id: true,
      event: true,
      status: true,
      attempts: true,
      responseStatus: true,
      lastError: true,
      nextAttemptAt: true,
      deliveredAt: true,
      createdAt: true,
    },
  });
  return serialize({ deliveries });
}

function assertEvents(events: unknown): string[] {
  const list = Array.isArray(events) ? events.filter(isWebhookEvent) : [];
  if (list.length === 0) {
    throw new UserFacingError({
      code: "NO_EVENTS",
      title: "No events selected",
      message: `Subscribe to at least one event. Valid events: ${WEBHOOK_EVENTS.join(", ")}.`,
      field: "events",
    });
  }
  return list;
}

function assertUrl(url: string): void {
  const check = validateWebhookUrl(url, {
    allowInsecure: process.env.NODE_ENV !== "production",
  });
  if (!check.ok) {
    throw new UserFacingError({
      code: "BAD_WEBHOOK_URL",
      title: "Invalid endpoint URL",
      message: check.reason ?? "The URL is not usable.",
      field: "url",
    });
  }
}

/**
 * Create an endpoint. Returns the signing `secret` exactly ONCE — it can be rotated
 * but never retrieved again.
 */
export async function createWebhook(input: {
  description: string;
  url: string;
  events: string[];
}) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const description = input.description?.trim();
  if (!description) {
    throw new UserFacingError({
      code: "NO_DESCRIPTION",
      title: "Description required",
      message: "Give the endpoint a label so you can recognise it later.",
      field: "description",
    });
  }

  assertUrl(input.url);
  const events = assertEvents(input.events);
  const secret = generateWebhookSecret();

  const created = await prisma.webhook.create({
    data: {
      organizationId,
      description,
      url: input.url,
      events: JSON.stringify(events),
      secret,
      createdById: userId,
    },
    select: READ_SHAPE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "webhook",
    entityId: created.id,
    entityName: description,
    summary: `Created webhook endpoint "${description}"`,
    metadata: { url: input.url, events },
  });

  return serialize({ secret, webhook: created });
}

/** Change the subscribed events or the description. The URL and secret are unchanged. */
export async function updateWebhook(
  id: string,
  input: { description?: string; events?: string[]; isActive?: boolean },
) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const existing = await prisma.webhook.findFirst({ where: { id, organizationId } });
  if (!existing) throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });

  const updated = await prisma.webhook.update({
    where: { id },
    data: {
      ...(input.description ? { description: input.description.trim() } : {}),
      ...(input.events ? { events: JSON.stringify(assertEvents(input.events)) } : {}),
      // Re-enabling clears the auto-disable state, so a fixed endpoint resumes cleanly.
      ...(input.isActive !== undefined
        ? {
            isActive: input.isActive,
            disabledAt: input.isActive ? null : new Date(),
            consecutiveFailures: input.isActive ? 0 : existing.consecutiveFailures,
          }
        : {}),
    },
    select: READ_SHAPE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "webhook",
    entityId: id,
    entityName: updated.description,
    summary: `Updated webhook endpoint "${updated.description}"`,
  });

  return serialize({ webhook: updated });
}

/**
 * Rotate the signing secret. The previous secret keeps working for `graceMinutes`
 * so a consumer can roll over without dropping deliveries.
 */
export async function rotateWebhookSecret(id: string, graceMinutes?: number) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const existing = await prisma.webhook.findFirst({ where: { id, organizationId } });
  if (!existing) throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });

  const secret = generateWebhookSecret();
  const grace = Math.min(Math.max(graceMinutes ?? 60, 0), 24 * 60);

  await prisma.webhook.update({
    where: { id },
    data: {
      secret,
      previousSecret: existing.secret,
      previousSecretExpiresAt: new Date(Date.now() + grace * 60_000),
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "webhook",
    entityId: id,
    entityName: existing.description,
    summary: `Rotated the signing secret for "${existing.description}"`,
    metadata: { graceMinutes: grace },
  });

  return serialize({ secret, previousSecretExpiresInMinutes: grace });
}

/** Delete an endpoint and its delivery log. Irreversible. */
export async function deleteWebhook(id: string) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const existing = await prisma.webhook.findFirst({ where: { id, organizationId } });
  if (!existing) throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });

  await prisma.webhook.delete({ where: { id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "webhook",
    entityId: id,
    entityName: existing.description,
    summary: `Deleted webhook endpoint "${existing.description}"`,
  });

  return serialize({ success: true });
}
