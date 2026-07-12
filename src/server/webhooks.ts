"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { generateWebhookSecret } from "@/lib/webhooks/sign";
import { validateWebhookUrl } from "@/lib/webhooks/url";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS, isWebhookEvent } from "@/lib/webhooks/events";
import { UserFacingError } from "@/lib/errors";

// Webhook is a Convex domain now (the Postgres `webhook`/`webhook_delivery` tables are
// frozen). Convex stores dates as epoch-ms; these mappers restore the old Prisma
// `select` shapes (Date fields, secret never leaked).
const d = (n: number | null | undefined) => (n != null ? new Date(n) : null);
type ConvexWebhook = {
  id: string; description: string; url: string; events?: string; isActive?: boolean;
  disabledAt?: number; consecutiveFailures?: number; lastDeliveryAt?: number; createdAt?: number;
};
function toWebhookRow(w: ConvexWebhook) {
  return {
    id: w.id, description: w.description, url: w.url,
    events: w.events ?? "[]",
    isActive: w.isActive ?? true,
    disabledAt: d(w.disabledAt),
    consecutiveFailures: w.consecutiveFailures ?? 0,
    lastDeliveryAt: d(w.lastDeliveryAt),
    createdAt: w.createdAt != null ? new Date(w.createdAt) : new Date(0),
  };
}
type ConvexDelivery = {
  id: string; event: string; status?: string; attempts?: number; responseStatus?: number;
  lastError?: string; nextAttemptAt?: number; deliveredAt?: number; createdAt?: number;
};
function toDeliveryRow(x: ConvexDelivery) {
  return {
    id: x.id, event: x.event, status: x.status ?? "PENDING", attempts: x.attempts ?? 0,
    responseStatus: x.responseStatus ?? null, lastError: x.lastError ?? null,
    nextAttemptAt: d(x.nextAttemptAt), deliveredAt: d(x.deliveredAt),
    createdAt: x.createdAt != null ? new Date(x.createdAt) : new Date(0),
  };
}

/**
 * Webhook endpoint management. Creating, rotating and deleting an endpoint are
 * `orgSettings:update` writes, and the whole module is marked `dangerous` in the API
 * registry — so an API key needs an explicit scope AND `confirm` + `idempotencyKey`.
 * An agent must not be able to quietly point your events at its own URL.
 *
 * See docs/designs/webhooks.md.
 */

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
  const rows = await (await getConvexClient()).query(api.webhooks.list, { orgId: organizationId });
  const webhooks = rows.map(toWebhookRow); // strips secret
  return serialize({ webhooks });
}

/** Recent delivery attempts for one endpoint — the self-serve debugging surface. */
export async function getWebhookDeliveries(webhookId: string, limit?: number) {
  const { organizationId } = await getOrgContext();
  const rows = await (await getConvexClient()).query(api.webhooks.deliveries, {
    orgId: organizationId,
    webhookId,
    limit,
  });
  const deliveries = rows.map(toDeliveryRow);
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

  const id = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.webhooks.create, {
    id,
    organizationId,
    description,
    url: input.url,
    events: JSON.stringify(events),
    secret,
    isActive: true,
    consecutiveFailures: 0,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  });
  const created = toWebhookRow({
    id, description, url: input.url, events: JSON.stringify(events),
    isActive: true, consecutiveFailures: 0, createdAt: now,
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

  // Build the patch; the Convex `update` mutation org-guards + returns the fresh doc.
  const patch: {
    description?: string;
    events?: string;
    isActive?: boolean;
    disabledAt?: number | null;
    consecutiveFailures?: number;
  } = {};
  if (input.description) patch.description = input.description.trim();
  if (input.events) patch.events = JSON.stringify(assertEvents(input.events));
  if (input.isActive !== undefined) {
    // Re-enabling clears the auto-disable state so a fixed endpoint resumes cleanly.
    patch.isActive = input.isActive;
    patch.disabledAt = input.isActive ? null : Date.now();
    if (input.isActive) patch.consecutiveFailures = 0;
  }

  let updatedDoc;
  try {
    updatedDoc = await (await getConvexClient()).mutation(api.webhooks.update, {
      id,
      orgId: organizationId,
      patch,
    });
  } catch {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });
  }
  const updated = toWebhookRow(updatedDoc as ConvexWebhook);

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

  const secret = generateWebhookSecret();
  const grace = Math.min(Math.max(graceMinutes ?? 60, 0), 24 * 60);

  // The mutation org-guards, sets previousSecret from the current secret internally,
  // and returns the endpoint's description for the audit line.
  let rotated: { id: string; description: string };
  try {
    rotated = await (await getConvexClient()).mutation(api.webhooks.rotateSecret, {
      id,
      orgId: organizationId,
      secret,
      previousSecretExpiresAt: Date.now() + grace * 60_000,
    });
  } catch {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "webhook",
    entityId: id,
    entityName: rotated.description,
    summary: `Rotated the signing secret for "${rotated.description}"`,
    metadata: { graceMinutes: grace },
  });

  return serialize({ secret, previousSecretExpiresInMinutes: grace });
}

/** Delete an endpoint and its delivery log. Irreversible. */
export async function deleteWebhook(id: string) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  // Convex remove org-guards, cascades the delivery log, and returns the description.
  let removed: { id: string; description: string };
  try {
    removed = await (await getConvexClient()).mutation(api.webhooks.remove, {
      id,
      orgId: organizationId,
    });
  } catch {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Not found", message: "Webhook endpoint not found." });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "webhook",
    entityId: id,
    entityName: removed.description,
    summary: `Deleted webhook endpoint "${removed.description}"`,
  });

  return serialize({ success: true });
}
