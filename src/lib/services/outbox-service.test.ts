import { describe, it, expect, vi } from "vitest";
import {
  ackOutboxEvents,
  emitOutboxEvent,
  readOutboxEvents,
  recordDiscordHeartbeat,
} from "./outbox-service";

describe("emitOutboxEvent", () => {
  it("creates a row with the typed payload + dedupeKey", async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { discordOutbox: { create } } as never;
    await emitOutboxEvent(tx, {
      organizationId: "org1",
      eventType: "project.created",
      payload: { projectId: "p1", projectNumber: "TTP001", name: "Pippin", status: "ENQUIRY" },
      dedupeKey: "project.created:p1",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org1",
        eventType: "project.created",
        dedupeKey: "project.created:p1",
      }),
    });
  });
});

describe("readOutboxEvents", () => {
  it("filters by org + id>since + undelivered status, oldest first, clamps limit", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 5, eventType: "project.created", payload: { a: 1 }, dedupeKey: "k5", createdAt: new Date("2026-06-04T00:00:00Z") },
    ]);
    const db = { discordOutbox: { findMany } } as never;
    const res = await readOutboxEvents("org1", 4, 9999, db, new Date("2026-06-04T01:00:00Z"));

    const args = findMany.mock.calls[0][0];
    expect(args.where.organizationId).toBe("org1");
    expect(args.where.id).toEqual({ gt: 4 });
    expect(args.orderBy).toEqual({ id: "asc" });
    expect(args.take).toBe(500); // clamped to MAX_LIMIT
    expect(res).toEqual([
      { id: 5, eventType: "project.created", payload: { a: 1 }, dedupeKey: "k5", createdAt: "2026-06-04T00:00:00.000Z" },
    ]);
  });
});

describe("ackOutboxEvents", () => {
  it("no-ops on an empty id list without touching the DB", async () => {
    const updateMany = vi.fn();
    const db = { discordOutbox: { updateMany } } as never;
    expect(await ackOutboxEvents("org1", [], db)).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("marks PROCESSED only org-scoped rows that aren't already processed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { discordOutbox: { updateMany } } as never;
    const now = new Date("2026-06-04T00:00:00Z");
    expect(await ackOutboxEvents("org1", [1, 2], db, now)).toBe(2);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ organizationId: "org1", id: { in: [1, 2] }, status: { not: "PROCESSED" } });
    expect(args.data).toMatchObject({ status: "PROCESSED", processedAt: now });
  });
});

describe("recordDiscordHeartbeat", () => {
  it("stamps lastHeartbeatAt and botUserId when provided", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { discordIntegration: { updateMany } } as never;
    const now = new Date("2026-06-04T00:00:00Z");
    await recordDiscordHeartbeat("org1", "bot42", db, now);
    expect(updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org1" },
      data: { lastHeartbeatAt: now, botUserId: "bot42" },
    });
  });
});
