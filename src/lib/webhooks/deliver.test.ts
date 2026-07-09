import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyWebhookSignature } from "./sign";

const findMany = vi.hoisted(() => vi.fn());
const deliveryUpdate = vi.hoisted(() => vi.fn());
const webhookUpdate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock("../prisma", () => ({
  prisma: {
    webhookDelivery: { findMany, update: deliveryUpdate },
    webhook: { update: webhookUpdate },
    $transaction: transaction,
  },
}));

const { deliverPendingWebhooks, MAX_ATTEMPTS, AUTO_DISABLE_AFTER } = await import("./deliver");

const NOW = new Date("2026-07-09T12:00:00.000Z");
const SECRET = "whsec_abc";

const row = (over: Record<string, unknown> = {}) => ({
  id: "whd_1",
  organizationId: "org_1",
  event: "project.status_changed",
  payload: JSON.stringify({ projectId: "p1", from: "QUOTE", to: "CONFIRMED" }),
  attempts: 0,
  createdAt: NOW,
  webhook: { id: "wh_1", url: "https://hooks.example.com/x", secret: SECRET, isActive: true },
  ...over,
});

const okResponse = (status = 200) => ({ status }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  deliveryUpdate.mockResolvedValue({});
  webhookUpdate.mockResolvedValue({ consecutiveFailures: 1 });
  transaction.mockResolvedValue([]);
});

describe("deliverPendingWebhooks — success", () => {
  it("POSTs a signed, verifiable envelope and marks the delivery succeeded", async () => {
    findMany.mockResolvedValue([row()]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(res).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/x");

    const headers = init.headers as Record<string, string>;
    expect(headers["X-GearFlow-Event"]).toBe("project.status_changed");
    expect(headers["X-GearFlow-Delivery-Id"]).toBe("whd_1");

    // The consumer can verify exactly the bytes we sent.
    expect(
      verifyWebhookSignature({
        rawBody: init.body as string,
        header: headers["X-GearFlow-Signature"],
        secrets: [SECRET],
        nowSeconds: Math.floor(NOW.getTime() / 1000),
      }),
    ).toEqual({ valid: true });

    // The envelope carries the delivery id, so a retry is dedupable.
    const envelope = JSON.parse(init.body as string);
    expect(envelope).toMatchObject({
      id: "whd_1",
      event: "project.status_changed",
      version: "v1",
      organizationId: "org_1",
      data: { projectId: "p1", from: "QUOTE", to: "CONFIRMED" },
    });

    // Success resets the failure streak.
    expect(transaction).toHaveBeenCalled();
  });

  it("treats any 2xx as success", async () => {
    findMany.mockResolvedValue([row()]);
    const res = await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(204)), now: NOW });
    expect(res.succeeded).toBe(1);
  });
});

describe("deliverPendingWebhooks — retries", () => {
  it("schedules exponential backoff and stays PENDING while attempts remain", async () => {
    findMany.mockResolvedValue([row({ attempts: 2 })]);
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    const data = deliveryUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.attempts).toBe(3);
    expect(data.lastError).toBe("HTTP 500");
    // attempt 3 -> 2^2 = 4 minutes
    expect(new Date(data.nextAttemptAt).getTime() - NOW.getTime()).toBe(4 * 60_000);
  });

  it("gives up after MAX_ATTEMPTS", async () => {
    findMany.mockResolvedValue([row({ attempts: MAX_ATTEMPTS - 1 })]);
    const res = await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    expect(deliveryUpdate.mock.calls[0][0].data.status).toBe("FAILED");
    expect(res.failed).toBe(1);
  });

  it("records a network error rather than throwing", async () => {
    findMany.mockResolvedValue([row()]);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(res.processed).toBe(1);
    expect(deliveryUpdate.mock.calls[0][0].data.lastError).toContain("ECONNREFUSED");
    expect(deliveryUpdate.mock.calls[0][0].data.status).toBe("PENDING");
  });
});

describe("deliverPendingWebhooks — endpoint health", () => {
  it("honours 410 Gone: fails immediately and disables the endpoint", async () => {
    findMany.mockResolvedValue([row()]);
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(410)), now: NOW });

    // No further retries for a consumer that said "stop".
    expect(deliveryUpdate.mock.calls[0][0].data.status).toBe("FAILED");
    const disable = webhookUpdate.mock.calls.find((c) => c[0].data.isActive === false);
    expect(disable).toBeTruthy();
    expect(disable![0].data.disabledAt).toEqual(NOW);
  });

  it("auto-disables a dead endpoint after AUTO_DISABLE_AFTER consecutive failures", async () => {
    findMany.mockResolvedValue([row()]);
    webhookUpdate.mockResolvedValueOnce({ consecutiveFailures: AUTO_DISABLE_AFTER });

    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    expect(webhookUpdate.mock.calls.some((c) => c[0].data.isActive === false)).toBe(true);
  });

  it("does NOT disable while below the threshold", async () => {
    findMany.mockResolvedValue([row()]);
    webhookUpdate.mockResolvedValueOnce({ consecutiveFailures: AUTO_DISABLE_AFTER - 1 });

    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    expect(webhookUpdate.mock.calls.some((c) => c[0].data.isActive === false)).toBe(false);
  });

  it("skips a delivery whose endpoint was disabled after it was enqueued", async () => {
    findMany.mockResolvedValue([row({ webhook: { id: "wh_1", url: "https://x", secret: SECRET, isActive: false } })]);
    const fetchImpl = vi.fn();

    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(deliveryUpdate.mock.calls[0][0].data.lastError).toContain("disabled");
  });
});

describe("deliverPendingWebhooks — claiming", () => {
  it("only claims pending rows whose backoff has elapsed", async () => {
    findMany.mockResolvedValue([]);
    await deliverPendingWebhooks({ now: NOW, fetchImpl: vi.fn() });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING", nextAttemptAt: { lte: NOW } },
      }),
    );
  });
});
