// Revived project board — pure drag/rot logic (#1244, design §8.3/§8.4).
// Unit-testable without mounting dnd-kit or the Convex client.
import { describe, test, expect } from "vitest";
import { rotTint, resolveBoardDrop } from "../project-board";
import type { DragEndEvent } from "@dnd-kit/core";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function dragEvent(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId } as DragEndEvent["active"],
    over: overId ? ({ id: overId } as NonNullable<DragEndEvent["over"]>) : null,
  } as DragEndEvent;
}

describe("rotTint", () => {
  test("only QUOTING/QUOTED projects can rot", () => {
    expect(rotTint({ status: "CONFIRMED", updatedAt: NOW - 30 * DAY }, NOW)).toBeNull();
  });

  test("no tint under the amber threshold", () => {
    expect(rotTint({ status: "QUOTED", updatedAt: NOW - 1 * DAY }, NOW)).toBeNull();
  });

  test("amber at 3+ days since last touch", () => {
    expect(rotTint({ status: "QUOTED", updatedAt: NOW - 3 * DAY }, NOW)).toBe("amber");
  });

  test("red at 7+ days since last touch", () => {
    expect(rotTint({ status: "QUOTING", updatedAt: NOW - 7 * DAY }, NOW)).toBe("red");
  });

  test("falls back to createdAt when updatedAt is absent, and to no tint with neither", () => {
    expect(rotTint({ status: "QUOTED", createdAt: NOW - 10 * DAY }, NOW)).toBe("red");
    expect(rotTint({ status: "QUOTED" }, NOW)).toBeNull();
  });
});

describe("resolveBoardDrop", () => {
  const projectById = new Map([
    ["p1", { id: "p1", status: "QUOTING" }],
    ["p2", { id: "p2", status: "CONFIRMED" }],
  ]);

  test("dropping into a different stage resolves to that stage's FIRST status", () => {
    const plan = resolveBoardDrop(dragEvent("p1", "payment"), projectById);
    expect(plan).toEqual({ projectId: "p1", currentStatus: "QUOTING", nextStatus: "AWAITING_PAYMENT" });
  });

  test("dropping on the SAME stage's column is a no-op", () => {
    // p1 is QUOTING, which is in the "quote" column already.
    expect(resolveBoardDrop(dragEvent("p1", "quote"), projectById)).toBeNull();
  });

  test("no drop target (over is null) is a no-op", () => {
    expect(resolveBoardDrop(dragEvent("p1", null), projectById)).toBeNull();
  });

  test("an unknown project id is a no-op", () => {
    expect(resolveBoardDrop(dragEvent("ghost", "payment"), projectById)).toBeNull();
  });

  test("an unknown target stage key is a no-op", () => {
    expect(resolveBoardDrop(dragEvent("p1", "not-a-stage"), projectById)).toBeNull();
  });
});
