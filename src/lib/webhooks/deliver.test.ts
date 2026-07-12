import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyWebhookSignature } from "./sign";

// Webhook data is Convex now. Route the mocked client's mutations by a distinguishing
// arg key (the vi.mock factory can't reference the imported `api`).
const dueDeliveries = vi.hoisted(() => vi.fn());
const claimDelivery = vi.hoisted(() => vi.fn());
const markSucceeded = vi.hoisted(() => vi.fn());
const markFailed = vi.hoisted(() => vi.fn());
const markEndpointDisabled = vi.hoisted(() => vi.fn());

vi.mock("./resolve-guard", () => ({ hostResolvesToPrivate: vi.fn().mockResolvedValue(false) }));
vi.mock("../convex-client", () => ({
  getConvexClient: vi.fn(async () => ({
    query: (_ref: unknown, args: Record<string, unknown>) => dueDeliveries(args),
    mutation: (_ref: unknown, args: Record<string, unknown>) => {
      if ("leaseMs" in args) return claimDelivery(args);
      if ("deliveredAt" in args) return markSucceeded(args);
      if ("autoDisableAfter" in args) return markFailed(args);
      if ("lastError" in args && !("webhookId" in args)) return markEndpointDisabled(args);
      return Promise.resolve();
    },
  })),
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
  nextAttemptAt: NOW.getTime(),
  createdAt: NOW.getTime(),
  webhook: { id: "wh_1", url: "https://hooks.example.com/x", secret: SECRET, previousSecret: null, previousSecretExpiresAt: null, isActive: true },
  ...over,
});

const okResponse = (status = 200) => ({ status }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: claim succeeds, bumping attempts to (row.attempts + 1).
  claimDelivery.mockImplementation((args: { id: string }) => Promise.resolve({ claimed: true, attempts: 1 }));
  markSucceeded.mockResolvedValue(undefined);
  markFailed.mockResolvedValue(undefined);
  markEndpointDisabled.mockResolvedValue(undefined);
});

describe("deliverPendingWebhooks — success", () => {
  it("POSTs a signed, verifiable envelope and marks the delivery succeeded", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(res).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/x");

    const headers = init.headers as Record<string, string>;
    expect(headers["X-GearFlow-Event"]).toBe("project.status_changed");
    expect(headers["X-GearFlow-Delivery-Id"]).toBe("whd_1");

    expect(
      verifyWebhookSignature({
        rawBody: init.body as string,
        header: headers["X-GearFlow-Signature"],
        secrets: [SECRET],
        nowSeconds: Math.floor(NOW.getTime() / 1000),
      }),
    ).toEqual({ valid: true });

    const envelope = JSON.parse(init.body as string);
    expect(envelope).toMatchObject({
      id: "whd_1",
      event: "project.status_changed",
      version: "v1",
      organizationId: "org_1",
      data: { projectId: "p1", from: "QUOTE", to: "CONFIRMED" },
    });

    // Success path records via markSucceeded (resets the failure streak inside the mutation).
    expect(markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "whd_1", webhookId: "wh_1", responseStatus: 200 }),
    );
  });

  it("treats any 2xx as success", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    const res = await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(204)), now: NOW });
    expect(res.succeeded).toBe(1);
  });
});

describe("deliverPendingWebhooks — retries", () => {
  it("claims the row atomically BEFORE sending", async () => {
    dueDeliveries.mockResolvedValue([row({ attempts: 0 })]);
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse()), now: NOW });
    expect(claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: "whd_1", now: NOW.getTime() }),
    );
  });

  it("does NOT send when the claim is lost to a concurrent worker", async () => {
    dueDeliveries.mockResolvedValue([row({ attempts: 0 })]);
    claimDelivery.mockResolvedValue({ claimed: false, attempts: 0 });
    const fetchImpl = vi.fn();
    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.processed).toBe(0);
  });

  it("schedules exponential backoff and stays PENDING while attempts remain", async () => {
    dueDeliveries.mockResolvedValue([row({ attempts: 2 })]);
    claimDelivery.mockResolvedValue({ claimed: true, attempts: 3 }); // claim -> attempts 3
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    const args = markFailed.mock.calls[0][0];
    expect(args.deliveryStatus).toBe("PENDING");
    expect(args.lastError).toBe("HTTP 500");
    // attempt 3 -> 2^2 = 4 minutes (epoch ms)
    expect(args.nextAttemptAt - NOW.getTime()).toBe(4 * 60_000);
  });

  it("does not follow redirects — a 3xx is a failed delivery, never an internal hop", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(302));
    await deliverPendingWebhooks({ fetchImpl, now: NOW });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
    expect(markFailed.mock.calls[0][0].deliveryStatus).toBe("PENDING");
    expect(markFailed.mock.calls[0][0].lastError).toBe("HTTP 302");
  });

  it("gives up after MAX_ATTEMPTS", async () => {
    dueDeliveries.mockResolvedValue([row({ attempts: MAX_ATTEMPTS - 1 })]);
    claimDelivery.mockResolvedValue({ claimed: true, attempts: MAX_ATTEMPTS });
    const res = await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });

    expect(markFailed.mock.calls[0][0].deliveryStatus).toBe("FAILED");
    expect(res.failed).toBe(1);
  });

  it("records a network error rather than throwing", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(res.processed).toBe(1);
    expect(markFailed.mock.calls[0][0].lastError).toContain("ECONNREFUSED");
    expect(markFailed.mock.calls[0][0].deliveryStatus).toBe("PENDING");
  });
});

describe("deliverPendingWebhooks — endpoint health", () => {
  it("honours 410 Gone: fails immediately and signals disable (gone=true)", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(410)), now: NOW });

    // 410 → exhausted FAILED + gone=true, which the markFailed mutation acts on to disable.
    expect(markFailed.mock.calls[0][0].deliveryStatus).toBe("FAILED");
    expect(markFailed.mock.calls[0][0].gone).toBe(true);
  });

  it("passes the auto-disable threshold to markFailed on every failure", async () => {
    dueDeliveries.mockResolvedValue([row()]);
    await deliverPendingWebhooks({ fetchImpl: vi.fn().mockResolvedValue(okResponse(500)), now: NOW });
    // The disable decision (consecutiveFailures >= threshold) is made atomically inside
    // the Convex markFailed mutation; the worker's job is to pass the threshold + gone.
    expect(markFailed.mock.calls[0][0].autoDisableAfter).toBe(AUTO_DISABLE_AFTER);
    expect(markFailed.mock.calls[0][0].gone).toBe(false);
  });

  it("fails out an orphaned delivery whose endpoint was deleted (no starvation)", async () => {
    dueDeliveries.mockResolvedValue([row({ webhook: null })]);
    const fetchImpl = vi.fn();

    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(markEndpointDisabled.mock.calls[0][0].lastError).toContain("no longer exists");
  });

  it("skips a delivery whose endpoint was disabled after it was enqueued", async () => {
    dueDeliveries.mockResolvedValue([row({ webhook: { id: "wh_1", url: "https://x", secret: SECRET, previousSecret: null, previousSecretExpiresAt: null, isActive: false } })]);
    const fetchImpl = vi.fn();

    const res = await deliverPendingWebhooks({ fetchImpl, now: NOW });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(markEndpointDisabled.mock.calls[0][0].lastError).toContain("disabled");
    expect(claimDelivery).not.toHaveBeenCalled();
  });
});

describe("deliverPendingWebhooks — claiming", () => {
  it("queries due deliveries at `now`", async () => {
    dueDeliveries.mockResolvedValue([]);
    await deliverPendingWebhooks({ now: NOW, fetchImpl: vi.fn() });
    expect(dueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW.getTime() }),
    );
  });
});

describe("deliverPendingWebhooks — secret rotation", () => {
  it("signs with both secrets during the grace window, so an un-rotated consumer verifies", async () => {
    const future = NOW.getTime() + 30 * 60_000;
    dueDeliveries.mockResolvedValue([
      row({ webhook: { id: "wh_1", url: "https://x/h", secret: "whsec_new", previousSecret: "whsec_old", previousSecretExpiresAt: future, isActive: true } }),
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await deliverPendingWebhooks({ fetchImpl, now: NOW });

    const init = fetchImpl.mock.calls[0][1];
    const header = (init.headers as Record<string, string>)["X-GearFlow-Signature"];
    expect(header.match(/v1=/g)).toHaveLength(2);
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    expect(verifyWebhookSignature({ rawBody: init.body as string, header, secrets: ["whsec_old"], nowSeconds }).valid).toBe(true);
    expect(verifyWebhookSignature({ rawBody: init.body as string, header, secrets: ["whsec_new"], nowSeconds }).valid).toBe(true);
  });

  it("drops the previous secret once its grace window has expired", async () => {
    const past = NOW.getTime() - 60_000;
    dueDeliveries.mockResolvedValue([
      row({ webhook: { id: "wh_1", url: "https://x/h", secret: "whsec_new", previousSecret: "whsec_old", previousSecretExpiresAt: past, isActive: true } }),
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await deliverPendingWebhooks({ fetchImpl, now: NOW });
    const header = (fetchImpl.mock.calls[0][1].headers as Record<string, string>)["X-GearFlow-Signature"];
    expect(header.match(/v1=/g)).toHaveLength(1);
  });
});
