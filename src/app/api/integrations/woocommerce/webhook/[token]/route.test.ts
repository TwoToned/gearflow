/**
 * The token-addressed WooCommerce webhook ingress (#1074, A4). Covers the
 * property the design is built around: an unknown token, a disabled
 * integration, and an archived org's token must all return the IDENTICAL
 * response — no enumeration oracle for which tokens are real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const getWooCommerceIntegrationByToken = vi.fn();
vi.mock("@/lib/woocommerce-integration-read", () => ({
  getWooCommerceIntegrationByToken: (...a: unknown[]) => getWooCommerceIntegrationByToken(...a),
}));

const organizationFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: (...a: unknown[]) => organizationFindUnique(...a) } },
}));

const findCompletedOrderLog = vi.fn();
vi.mock("@/lib/woocommerce-order-logs-read", () => ({
  findCompletedOrderLog: (...a: unknown[]) => findCompletedOrderLog(...a),
}));

const processWooCommerceOrder = vi.fn();
vi.mock("@/server/woocommerce", () => ({
  processWooCommerceOrder: (...a: unknown[]) => processWooCommerceOrder(...a),
}));

const convexMutation = vi.fn(async () => undefined);
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ mutation: convexMutation })),
}));

let rateLimitResult = { allowed: true, retryAfterMs: 0 };
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => rateLimitResult,
  getClientIp: () => "1.2.3.4",
}));

const { POST } = await import("./route");

const WEBHOOK_TOKEN = "test-token-abc123";
const SECRET = "shh-its-a-secret";

function integrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wc_1",
    organizationId: "org_1",
    isEnabled: true,
    webhookSecret: SECRET,
    webhookToken: WEBHOOK_TOKEN,
    ...overrides,
  };
}

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

function postRequest(body: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/integrations/woocommerce/webhook/${WEBHOOK_TOKEN}`, {
    method: "POST",
    body,
    headers,
  });
}

function params() {
  return { params: Promise.resolve({ token: WEBHOOK_TOKEN }) };
}

const ORDER_BODY = JSON.stringify({
  id: 42,
  number: "42",
  billing: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
  line_items: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitResult = { allowed: true, retryAfterMs: 0 };
  organizationFindUnique.mockResolvedValue({ archivedAt: null });
  findCompletedOrderLog.mockResolvedValue(null);
});

describe("identical-response invariant", () => {
  it("404s for an unknown token", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(null);
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s identically for a disabled integration", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow({ isEnabled: false }));
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s identically for an archived org", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    organizationFindUnique.mockResolvedValue({ archivedAt: new Date() });
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s identically when the org no longer exists", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    organizationFindUnique.mockResolvedValue(null);
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("rate limiting", () => {
  it("429s once the per-IP limit is exceeded, before ever resolving the token", async () => {
    rateLimitResult = { allowed: false, retryAfterMs: 5000 };
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(429);
    expect(getWooCommerceIntegrationByToken).not.toHaveBeenCalled();
  });
});

describe("ping handling", () => {
  it("accepts a ping without signature verification, only after the token resolves", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    const res = await POST(
      postRequest("{}", { "X-WC-Webhook-Topic": "action.woocommerce_webhook_delivery" }) as never,
      params(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ping: true });
  });

  it("still 404s a ping against an unknown token — ping can't probe token validity", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(null);
    const res = await POST(
      postRequest("{}", { "X-WC-Webhook-Topic": "action.woocommerce_webhook_delivery" }) as never,
      params(),
    );
    expect(res.status).toBe(404);
  });
});

describe("signature verification", () => {
  it("rejects a missing signature", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    const res = await POST(postRequest(ORDER_BODY) as never, params());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing signature" });
  });

  it("rejects an invalid signature", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    const res = await POST(
      postRequest(ORDER_BODY, { "X-WC-Webhook-Signature": "bogus==" }) as never,
      params(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });

  it("accepts a valid signature, validates the payload, and dispatches processing", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    const signature = sign(ORDER_BODY, SECRET);
    processWooCommerceOrder.mockResolvedValue(undefined);

    const res = await POST(
      postRequest(ORDER_BODY, {
        "X-WC-Webhook-Signature": signature,
        "X-WC-Webhook-Topic": "order.created",
      }) as never,
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 42 });
    expect(processWooCommerceOrder).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ id: 42 }),
      expect.objectContaining({ id: "wc_1" }),
    );
  });

  it("rejects a schema-invalid payload even with a valid signature", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    const badBody = JSON.stringify({ id: 42 }); // missing required billing/line_items
    const signature = sign(badBody, SECRET);

    const res = await POST(
      postRequest(badBody, {
        "X-WC-Webhook-Signature": signature,
        "X-WC-Webhook-Topic": "order.created",
      }) as never,
      params(),
    );

    expect(res.status).toBe(422);
  });
});

describe("idempotency", () => {
  it("logs a duplicate and skips reprocessing an already-completed order", async () => {
    getWooCommerceIntegrationByToken.mockResolvedValue(integrationRow());
    findCompletedOrderLog.mockResolvedValue({ id: "log_1" });
    const signature = sign(ORDER_BODY, SECRET);

    const res = await POST(
      postRequest(ORDER_BODY, {
        "X-WC-Webhook-Signature": signature,
        "X-WC-Webhook-Topic": "order.created",
      }) as never,
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(processWooCommerceOrder).not.toHaveBeenCalled();
  });
});
