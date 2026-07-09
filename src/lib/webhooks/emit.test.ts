import { describe, it, expect, vi, beforeEach } from "vitest";

const webhookFindMany = vi.hoisted(() => vi.fn());
const deliveryCreateMany = vi.hoisted(() => vi.fn());

vi.mock("../prisma", () => ({
  prisma: {
    webhook: { findMany: webhookFindMany },
    webhookDelivery: { createMany: deliveryCreateMany },
  },
}));

const { emitWebhookEvent } = await import("./emit");

beforeEach(() => {
  vi.clearAllMocks();
  deliveryCreateMany.mockResolvedValue({ count: 1 });
});

describe("emitWebhookEvent", () => {
  it("enqueues one delivery per subscribed endpoint", async () => {
    webhookFindMany.mockResolvedValue([
      { id: "wh_1", events: JSON.stringify(["project.status_changed", "line_item.added"]) },
      { id: "wh_2", events: JSON.stringify(["project.status_changed"]) },
    ]);

    const res = await emitWebhookEvent("org_1", "project.status_changed", { projectId: "p1" });

    expect(res.enqueued).toBe(2);
    expect(deliveryCreateMany).toHaveBeenCalledWith({
      data: [
        { organizationId: "org_1", webhookId: "wh_1", event: "project.status_changed", payload: '{"projectId":"p1"}' },
        { organizationId: "org_1", webhookId: "wh_2", event: "project.status_changed", payload: '{"projectId":"p1"}' },
      ],
    });
  });

  it("ignores endpoints not subscribed to the event", async () => {
    webhookFindMany.mockResolvedValue([{ id: "wh_1", events: JSON.stringify(["maintenance.created"]) }]);

    const res = await emitWebhookEvent("org_1", "project.status_changed", {});

    expect(res.enqueued).toBe(0);
    expect(deliveryCreateMany).not.toHaveBeenCalled();
  });

  it("only considers active endpoints of this org", async () => {
    webhookFindMany.mockResolvedValue([]);
    await emitWebhookEvent("org_1", "line_item.added", {});
    expect(webhookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1", isActive: true } }),
    );
  });

  it("tolerates a garbage events column instead of throwing", async () => {
    webhookFindMany.mockResolvedValue([{ id: "wh_1", events: "not json" }]);
    await expect(emitWebhookEvent("org_1", "line_item.added", {})).resolves.toEqual({ enqueued: 0 });
  });

  it("NEVER throws — a webhook must not roll back the write that produced it", async () => {
    webhookFindMany.mockRejectedValue(new Error("database is on fire"));
    await expect(emitWebhookEvent("org_1", "warehouse.checked_out", {})).resolves.toEqual({
      enqueued: 0,
    });
  });

  it("never throws when the enqueue itself fails", async () => {
    webhookFindMany.mockResolvedValue([{ id: "wh_1", events: JSON.stringify(["line_item.added"]) }]);
    deliveryCreateMany.mockRejectedValue(new Error("unique violation"));
    await expect(emitWebhookEvent("org_1", "line_item.added", {})).resolves.toEqual({ enqueued: 0 });
  });
});
