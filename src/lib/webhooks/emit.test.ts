import { describe, it, expect, vi, beforeEach } from "vitest";

// Webhook data is Convex now.
const activeSubscriptions = vi.hoisted(() => vi.fn());
const enqueueDeliveries = vi.hoisted(() => vi.fn());

vi.mock("../convex-client", () => ({
  getConvexClient: vi.fn(async () => ({
    query: (_ref: unknown, args: Record<string, unknown>) => activeSubscriptions(args),
    mutation: (_ref: unknown, args: Record<string, unknown>) => enqueueDeliveries(args),
  })),
}));
// The fire-and-forget delivery kick is irrelevant to enqueue behaviour.
vi.mock("./deliver", () => ({ deliverPendingWebhooks: vi.fn().mockResolvedValue({}) }));

const { emitWebhookEvent } = await import("./emit");

beforeEach(() => {
  vi.clearAllMocks();
  enqueueDeliveries.mockResolvedValue({ enqueued: 1 });
});

describe("emitWebhookEvent", () => {
  it("enqueues one delivery per subscribed endpoint", async () => {
    activeSubscriptions.mockResolvedValue([
      { id: "wh_1", events: JSON.stringify(["project.status_changed", "line_item.added"]) },
      { id: "wh_2", events: JSON.stringify(["project.status_changed"]) },
    ]);

    const res = await emitWebhookEvent("org_1", "project.status_changed", { projectId: "p1" });

    expect(res.enqueued).toBe(2);
    const arg = enqueueDeliveries.mock.calls[0][0] as {
      deliveries: Array<{ id: string; organizationId: string; webhookId: string; event: string; payload: string }>;
    };
    expect(arg.deliveries).toHaveLength(2);
    // Each delivery targets a subscribed endpoint with the same event + payload; the id
    // is a freshly-minted cuid (stable envelope id), so assert structurally.
    expect(arg.deliveries.map((d) => d.webhookId)).toEqual(["wh_1", "wh_2"]);
    for (const d of arg.deliveries) {
      expect(d).toMatchObject({ organizationId: "org_1", event: "project.status_changed", payload: '{"projectId":"p1"}' });
      expect(typeof d.id).toBe("string");
      expect(d.id.length).toBeGreaterThan(0);
    }
  });

  it("ignores endpoints not subscribed to the event", async () => {
    activeSubscriptions.mockResolvedValue([{ id: "wh_1", events: JSON.stringify(["maintenance.created"]) }]);

    const res = await emitWebhookEvent("org_1", "project.status_changed", {});

    expect(res.enqueued).toBe(0);
    expect(enqueueDeliveries).not.toHaveBeenCalled();
  });

  it("only considers this org's active endpoints", async () => {
    activeSubscriptions.mockResolvedValue([]);
    await emitWebhookEvent("org_1", "line_item.added", {});
    expect(activeSubscriptions).toHaveBeenCalledWith({ orgId: "org_1" });
  });

  it("tolerates a garbage events column instead of throwing", async () => {
    activeSubscriptions.mockResolvedValue([{ id: "wh_1", events: "not json" }]);
    await expect(emitWebhookEvent("org_1", "line_item.added", {})).resolves.toEqual({ enqueued: 0 });
  });

  it("NEVER throws — a webhook must not roll back the write that produced it", async () => {
    activeSubscriptions.mockRejectedValue(new Error("backend is on fire"));
    await expect(emitWebhookEvent("org_1", "warehouse.checked_out", {})).resolves.toEqual({
      enqueued: 0,
    });
  });

  it("never throws when the enqueue itself fails", async () => {
    activeSubscriptions.mockResolvedValue([{ id: "wh_1", events: JSON.stringify(["line_item.added"]) }]);
    enqueueDeliveries.mockRejectedValue(new Error("write failed"));
    await expect(emitWebhookEvent("org_1", "line_item.added", {})).resolves.toEqual({ enqueued: 0 });
  });
});
