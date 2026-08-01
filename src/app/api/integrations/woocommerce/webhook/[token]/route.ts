import { createId } from "@paralleldrive/cuid2";
import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../../convex/_generated/api";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyWebhookSignature } from "@/lib/woocommerce-utils";
import { findCompletedOrderLog } from "@/lib/woocommerce-order-logs-read";
import { getWooCommerceIntegrationByToken } from "@/lib/woocommerce-integration-read";
import { processWooCommerceOrder } from "@/server/woocommerce";
import { wooOrderSchema } from "@/lib/validations/woocommerce";

const MAX_PAYLOAD_SIZE = 1_000_000; // 1MB

/**
 * POST /api/integrations/woocommerce/webhook/[token]
 *
 * The opaque per-org URL token (#1074, A4) replaces the old `?org=`/oldest-org
 * fallback — it both selects the integration row AND is the only thing standing
 * between an internet request and org resolution here (this route has no
 * session). An unknown token, a disabled integration, and an archived org
 * (#1075, A5) all return the IDENTICAL 404 below — never distinguish them, or
 * a scan of random tokens becomes an enumeration oracle for which ones are real.
 */
function notFound(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Rate limit by IP — the token is effectively a bearer credential, so this
  // guards against brute-force token enumeration. One legitimate store's order
  // volume stays well under this; it's sized for abuse, not throughput.
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = rateLimit(`woo-webhook:${ip}`, 60, 60_000);
  if (!allowed) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  // 1. Payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  // 2. Resolve the org via the token, and gate on enabled + not-archived, before
  //    touching the body at all — unknown/disabled/archived are all the same 404.
  const integration = await getWooCommerceIntegrationByToken(token);
  if (!integration) return notFound();

  const org = await prisma.organization.findUnique({
    where: { id: integration.organizationId },
    select: { archivedAt: true },
  });
  if (!org || org.archivedAt) return notFound();
  if (!integration.isEnabled) return notFound();

  const orgId = integration.organizationId;

  // 3. Read the raw body (needed for HMAC verification)
  const rawBody = await request.text();
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  // 4. Get headers
  const signature = request.headers.get("X-WC-Webhook-Signature");
  const topic = request.headers.get("X-WC-Webhook-Topic");

  // 5. Handle WooCommerce ping (sent on webhook creation to verify the URL is reachable)
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

  // 6. Verify HMAC-SHA256 signature
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

  // 7. Validate the payload shape now that the sender is authenticated (trust
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

  // 8. Store last payload for "Test & Detect" feature (Convex-only update)
  await (await getConvexClient()).mutation(api.wooCommerceIntegrations.update, {
    id: integration.id,
    patch: { lastPayload: order, updatedAt: Date.now() },
  });

  // 9. Only process order.created topic
  if (topic && topic !== "order.created") {
    return Response.json({ ok: true, skipped: true, reason: `Topic ${topic} not handled` });
  }

  // 10. Idempotency: check if this order was already processed (wooCommerceOrderLog
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

  // 11. Process the order asynchronously — respond 200 immediately
  processWooCommerceOrder(orgId, order, integration).catch((err) => {
    logger.error("[WooCommerce] Background processing error", { error: err });
  });

  // 12. Respond 200 immediately (WooCommerce retries on non-200)
  return Response.json({ ok: true, received: order.id });
}
