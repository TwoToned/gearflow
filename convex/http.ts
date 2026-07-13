import { httpRouter } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Convex HTTP router — WooCommerce webhook ingress (Convex-native migration).
 *
 * Faithful port of the Next.js route `src/app/api/integrations/woocommerce/
 * webhook/route.ts`. Runs on Convex Cloud; the ORIGINAL Next route is left intact
 * for dual-accept during the URL swap — the shared Convex order-log dedup makes
 * running both safe.
 *
 * The HMAC scheme reproduces `verifyWebhookSignature` (src/lib/woocommerce-utils.ts)
 * exactly, in Web Crypto: HMAC-SHA-256 over the UTF-8 raw body bytes, keyed on the
 * UTF-8 secret bytes, base64-encoded, then constant-time compared to the header.
 *
 * AUTH: all DB access goes through UNGUARDED `internalQuery`/`internalMutation`
 * wrappers in convex/wooCommerceInternal.ts. Those are unreachable from clients by
 * construction, so — unlike the service-gated `api.*` CRUD — they need no SERVICE
 * identity, which an externally-triggered HTTP action does not have.
 */

const MAX_PAYLOAD_SIZE = 1_000_000; // 1MB

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** HMAC-SHA256(secret, message) → standard base64. Mirrors Node's
 * crypto.createHmac("sha256", secret).update(message).digest("base64"). */
async function computeHmacBase64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Constant-time string compare (equal length + XOR fold). Mirrors the outcome of
 * Node's timingSafeEqual on the two base64 strings (base64 is ASCII), including
 * treating a length mismatch as "not equal" rather than throwing. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await computeHmacBase64(secret, rawBody);
  return timingSafeEqualStr(signature, expected);
}

const wooWebhook = httpAction(async (ctx, request) => {
  // 1. Payload size check
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
    return json({ error: "Payload too large" }, 413);
  }

  // 2. Read the raw body (needed for HMAC verification)
  const rawBody = await request.text();
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    return json({ error: "Payload too large" }, 413);
  }

  // 3. Get headers
  const signature = request.headers.get("X-WC-Webhook-Signature");
  const topic = request.headers.get("X-WC-Webhook-Topic");

  // 4. Handle WooCommerce ping (no signature check — no sensitive data).
  if (topic === "action.woocommerce_webhook_delivery") {
    return json({ ok: true, ping: true });
  }

  let parsed: { id?: number; number?: string } | undefined;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Not valid JSON — treat as ping if body is empty/minimal
  }
  if (!parsed?.id) {
    return json({ ok: true, ping: true });
  }

  // 5. Determine org — an explicit ?org= param, else the single org (mirrors the
  // Next route's getTheOrg()). A missing single org → "No organization configured".
  let orgId = new URL(request.url).searchParams.get("org");
  if (!orgId) {
    const org = await ctx.runQuery(internal.wooCommerceInternal.getSingleOrg, {});
    if (!org) {
      return json({ error: "No organization configured" }, 404);
    }
    orgId = org.id;
  }

  // 6. Load the org's integration; require it enabled (mapped isEnabled defaults to
  // false when absent, matching mapWooCommerceIntegration).
  const integration = await ctx.runQuery(internal.wooCommerceInternal.getIntegrationByOrg, {
    orgId,
  });
  if (!integration || (integration.isEnabled ?? false) !== true) {
    return json({ error: "Integration not enabled" }, 404);
  }
  const webhookSecret = integration.webhookSecret ?? "";

  // 7. Verify HMAC-SHA256 signature
  if (!signature) {
    return json({ error: "Missing signature" }, 401);
  }
  try {
    if (!(await verifyWebhookSignature(rawBody, signature, webhookSecret))) {
      return json({ error: "Invalid signature" }, 401);
    }
  } catch {
    return json({ error: "Invalid signature" }, 401);
  }

  const order = parsed as { id: number; number?: string };

  // 9. Store last payload for "Test & Detect".
  await ctx.runMutation(internal.wooCommerceInternal.updateIntegrationLastPayload, {
    id: integration.id,
    lastPayload: order,
    updatedAt: Date.now(),
  });

  // 10. Only process order.created topic
  if (topic && topic !== "order.created") {
    return json({ ok: true, skipped: true, reason: `Topic ${topic} not handled` });
  }

  // 11. Idempotency: skip if this order already completed (read-before-write dedup).
  const existing = await ctx.runQuery(internal.wooCommerceInternal.findCompletedLogByOrder, {
    orgId,
    wooOrderId: order.id,
  });
  if (existing) {
    await ctx.runMutation(internal.wooCommerceInternal.createLog, {
      id: createId(),
      organizationId: orgId,
      wooOrderId: order.id,
      wooOrderNumber: order.number ?? undefined,
      status: "DUPLICATE",
      payload: order,
      createdAt: Date.now(),
    });
    return json({ ok: true, duplicate: true });
  }

  // 12. Process asynchronously — respond 200 immediately (WooCommerce retries on non-200).
  await ctx.scheduler.runAfter(0, internal.wooCommerceActions.processOrder, {
    orgId,
    order,
    integrationId: integration.id,
  });

  // 13. Respond 200 immediately
  return json({ ok: true, received: order.id });
});

const http = httpRouter();

http.route({
  path: "/webhooks/woo",
  method: "POST",
  handler: wooWebhook,
});

export default http;
