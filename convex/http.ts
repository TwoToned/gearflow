import { httpRouter } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Convex HTTP router — WooCommerce webhook ingress (Convex-native migration).
 *
 * Faithful port of the Next.js route `src/app/api/integrations/woocommerce/
 * webhook/[token]/route.ts`. Runs on Convex Cloud; the ORIGINAL Next route is
 * left intact for dual-accept during the URL swap — the shared Convex order-log
 * dedup makes running both safe. The settings UI has only ever generated the
 * Next route's URL (FEATUREDOCS/35), so this one is understood to be vestigial
 * in production — kept working, not actively served.
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

  // 2. Resolve the org from the opaque path token (#1074, A4) — mirrors the
  // Next route (src/app/api/integrations/woocommerce/webhook/[token]/route.ts),
  // which is the real ingress; this httpAction is understood to be vestigial
  // (no UI has ever generated a /webhooks/woo/* URL, see FEATUREDOCS/35) but is
  // kept working rather than left referencing the now-deleted ?org=/getSingleOrg
  // scheme. Resolved BEFORE the ping check below, and an unknown token / a
  // disabled integration return the SAME 404 — no enumeration oracle.
  //
  // NOTE: unlike the Next route, this does NOT check Organization.archivedAt
  // (#1075) — that lives on Postgres, unreachable from a Convex httpAction. A
  // webhook hitting this vestigial path for an archived org's token is a known,
  // documented gap (see getIntegrationByWebhookToken's doc comment).
  const token = new URL(request.url).pathname.replace(/^\/webhooks\/woo\//, "");
  const integration = await ctx.runQuery(internal.wooCommerceInternal.getIntegrationByWebhookToken, {
    webhookToken: token,
  });
  if (!integration || (integration.isEnabled ?? false) !== true) {
    return json({ error: "Not found" }, 404);
  }
  const orgId = integration.organizationId;
  const webhookSecret = integration.webhookSecret ?? "";

  // 3. Read the raw body (needed for HMAC verification)
  const rawBody = await request.text();
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    return json({ error: "Payload too large" }, 413);
  }

  // 4. Get headers
  const signature = request.headers.get("X-WC-Webhook-Signature");
  const topic = request.headers.get("X-WC-Webhook-Topic");

  // 5. Handle WooCommerce ping (no signature check — no sensitive data).
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

  // 6. Verify HMAC-SHA256 signature
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
  pathPrefix: "/webhooks/woo/",
  method: "POST",
  handler: wooWebhook,
});

export default http;
