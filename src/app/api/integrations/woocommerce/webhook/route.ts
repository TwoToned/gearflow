import { prisma } from "@/lib/prisma";
import { getTheOrg } from "@/lib/single-org";
import { verifyWebhookSignature } from "@/lib/woocommerce-utils";
import {
  processWooCommerceOrder,
  type WooOrder,
} from "@/server/woocommerce";

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

  // 4. Determine org — single-org mode uses the only org, or fallback to ?org= param
  let orgId = new URL(request.url).searchParams.get("org");
  if (!orgId) {
    const org = await getTheOrg();
    if (!org) {
      return Response.json({ error: "No organization configured" }, { status: 404 });
    }
    orgId = org.id;
  }

  // 5. Load the org's WooCommerce integration config
  const integration = await prisma.wooCommerceIntegration.findUnique({
    where: { organizationId: orgId },
  });
  if (!integration?.isEnabled) {
    return Response.json({ error: "Integration not enabled" }, { status: 404 });
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

  // 7. Parse the order payload
  let order: WooOrder;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 8. Handle WooCommerce ping (sent on webhook creation — empty or minimal payload)
  if (!order.id) {
    return Response.json({ ok: true, ping: true });
  }

  // 9. Store last payload for "Test & Detect" feature
  await prisma.wooCommerceIntegration.update({
    where: { organizationId: orgId },
    data: { lastPayload: order as never },
  });

  // 10. Only process order.created topic
  if (topic && topic !== "order.created") {
    return Response.json({ ok: true, skipped: true, reason: `Topic ${topic} not handled` });
  }

  // 11. Idempotency: check if this order was already processed
  const existing = await prisma.wooCommerceOrderLog.findFirst({
    where: {
      organizationId: orgId,
      wooOrderId: order.id,
      status: "COMPLETED",
    },
  });
  if (existing) {
    // Log as duplicate
    await prisma.wooCommerceOrderLog.create({
      data: {
        organizationId: orgId,
        wooOrderId: order.id,
        wooOrderNumber: order.number ?? null,
        status: "DUPLICATE",
        payload: order as never,
      },
    });
    return Response.json({ ok: true, duplicate: true });
  }

  // 12. Process the order asynchronously — respond 200 immediately
  processWooCommerceOrder(orgId, order, integration).catch((err) => {
    console.error("[WooCommerce] Background processing error:", err);
  });

  // 13. Respond 200 immediately (WooCommerce retries on non-200)
  return Response.json({ ok: true, received: order.id });
}
