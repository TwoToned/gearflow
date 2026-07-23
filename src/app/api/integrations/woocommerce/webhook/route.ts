import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/lib/logger";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../convex/_generated/api";
import { getTheOrg } from "@/lib/single-org";
import { verifyWebhookSignature } from "@/lib/woocommerce-utils";
import { findCompletedOrderLog } from "@/lib/woocommerce-order-logs-read";
import { getWooCommerceIntegrationByOrg } from "@/lib/woocommerce-integration-read";
import { processWooCommerceOrder } from "@/server/woocommerce";
import { wooOrderSchema } from "@/lib/validations/woocommerce";

const MAX_PAYLOAD_SIZE = 1_000_000; // 1MB

export async function POST(request: Request) {
  // 1. Payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  // 2. Read the raw body (needed for HMAC verification)
  const rawBody = await request.text();
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  // 3. Get headers
  const signature = request.headers.get("X-WC-Webhook-Signature");
  const topic = request.headers.get("X-WC-Webhook-Topic");

  // 4. Handle WooCommerce ping (sent on webhook creation to verify the URL is reachable)
  //    Ping has topic "action.woocommerce_webhook_delivery" or no topic, and minimal/empty body.
  //    We accept it without signature verification since it contains no sensitive data.
  if (topic === "action.woocommerce_webhook_delivery") {
    return Response.json({ ok: true, ping: true });
  }

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawBody);
  } catch {
    // Not valid JSON — treat as ping if body is empty/minimal
  }
  // Cheap presence check only — the full shape is NOT trusted until it passes
  // both signature verification (below) and the wooOrderSchema parse (R-8.2.3).
  const maybeId = (rawParsed as { id?: unknown } | null | undefined)?.id;
  if (!maybeId) {
    return Response.json({ ok: true, ping: true });
  }

  // 5. Determine org — single-org mode uses the only org, or fallback to ?org= param
  let orgId = new URL(request.url).searchParams.get("org");
  if (!orgId) {
    const org = await getTheOrg();
    if (!org) {
      return Response.json({ error: "No organization configured" }, { status: 404 });
    }
    orgId = org.id;
  }

  // 6. Load the org's WooCommerce integration config (Convex-only)
  const integration = await getWooCommerceIntegrationByOrg(orgId);
  if (!integration?.isEnabled) {
    return Response.json({ error: "Integration not enabled" }, { status: 404 });
  }

  // 7. Verify HMAC-SHA256 signature
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }
  try {
    if (!verifyWebhookSignature(rawBody, signature, integration.webhookSecret)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 8. Validate the payload shape now that the sender is authenticated (trust
  //    boundary — R-8.2.3). Only known fields survive; the rest of WooCommerce's
  //    order payload is dropped.
  const result = wooOrderSchema.safeParse(rawParsed);
  if (!result.success) {
    logger.error("[WooCommerce] Webhook payload failed schema validation", {
      error: result.error.flatten(),
    });
    return Response.json({ error: "Invalid order payload" }, { status: 422 });
  }
  const order = result.data;

  // 9. Store last payload for "Test & Detect" feature (Convex-only update)
  await (await getConvexClient()).mutation(api.wooCommerceIntegrations.update, {
    id: integration.id,
    patch: { lastPayload: order, updatedAt: Date.now() },
  });

  // 10. Only process order.created topic
  if (topic && topic !== "order.created") {
    return Response.json({ ok: true, skipped: true, reason: `Topic ${topic} not handled` });
  }

  // 11. Idempotency: check if this order was already processed (wooCommerceOrderLog
  //     is Convex-only — read-before-write dedup replaces the Prisma findFirst).
  const existing = await findCompletedOrderLog(orgId, order.id);
  if (existing) {
    // Log as duplicate (Convex-only write).
    await (await getConvexClient()).mutation(api.wooCommerceOrderLogs.create, {
      id: createId(),
      organizationId: orgId,
      wooOrderId: order.id,
      wooOrderNumber: order.number ?? undefined,
      status: "DUPLICATE",
      payload: order,
      createdAt: Date.now(),
    });
    return Response.json({ ok: true, duplicate: true });
  }

  // 12. Process the order asynchronously — respond 200 immediately
  processWooCommerceOrder(orgId, order, integration).catch((err) => {
    logger.error("[WooCommerce] Background processing error", { error: err });
  });

  // 13. Respond 200 immediately (WooCommerce retries on non-200)
  return Response.json({ ok: true, received: order.id });
}
