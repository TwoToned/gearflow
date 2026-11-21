// @vitest-environment jsdom
// UX Phase 8 (§7b.3) — the drag wiring: a drop event on a card header reaches the
// ONE `onDrop` exactly once, carrying what `resolveDrop` decided (whole selection
// for a ticked row; refusal for a sealed card or a packed line). dnd-kit's
// DndContext is replaced by a passthrough that captures its handlers, so the test
// drives the same `onDragEnd` the pointer sensor would, without jsdom layout.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";

const captured = vi.hoisted(() => ({ props: null as null | { onDragStart: (e: unknown) => void; onDragEnd: (e: DragEndEvent) => void } }));
vi.mock("@dnd-kit/core", async (orig) => {
  const actual = await orig<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: { children: React.ReactNode; onDragStart: (e: unknown) => void; onDragEnd: (e: DragEndEvent) => void }) => {
      captured.props = props;
      return <>{props.children}</>;
    },
  };
});

import { PackingDndProvider, type DropTarget } from "../packing/packing-dnd";
import type { DropPlan } from "@/lib/packing-tab";

const targets: DropTarget[] = [
  { id: null, label: "Unplanned", sealed: false },
  { id: "lx", label: "LX-02", sealed: false },
  { id: "sl", label: "SEAL-01", sealed: true },
];
const drag = (activeId: string, overId: string | null) =>
  ({ active: { id: activeId }, over: overId ? { id: overId } : null }) as unknown as DragEndEvent;

let onDrop: ReturnType<typeof vi.fn<(plan: DropPlan) => void>>;
beforeEach(() => {
  onDrop = vi.fn();
});

function mount(selected: string[] = [], canDrag: (id: string) => boolean = () => true) {
  render(
    <PackingDndProvider selected={new Set(selected)} canDrag={canDrag} targets={targets} onDrop={onDrop}>
      <div />
    </PackingDndProvider>,
  );
}

describe("PackingDndProvider", () => {
  it("a drop on a case card calls onDrop ONCE with that line and case", () => {
    mount();
    captured.props!.onDragEnd(drag("par", "case:lx"));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({ kind: "plan", ids: ["par"], target: { id: "lx", label: "LX-02" } });
  });

  it("a ticked row drags the whole selection", () => {
    mount(["par", "panel"]);
    captured.props!.onDragEnd(drag("par", "case:lx"));
    expect(onDrop).toHaveBeenCalledWith({ kind: "plan", ids: ["par", "panel"], target: { id: "lx", label: "LX-02" } });
  });

  it("a drop on the Unplanned card un-plans", () => {
    mount();
    captured.props!.onDragEnd(drag("aura", "case:__unplanned"));
    expect(onDrop).toHaveBeenCalledWith({ kind: "plan", ids: ["aura"], target: null });
  });

  it("a sealed card refuses the drop (naming Unseal) and a packed line refuses too", () => {
    mount();
    captured.props!.onDragEnd(drag("par", "case:sl"));
    expect(onDrop).toHaveBeenLastCalledWith({ kind: "refused", message: "SEAL-01 is sealed. Unseal it to plan lines into it." });
    onDrop.mockClear();
    mount([], (id) => id !== "wash");
    captured.props!.onDragEnd(drag("wash", "case:lx"));
    expect(onDrop).toHaveBeenCalledWith({ kind: "refused", message: "Packed lines stay where the warehouse put them." });
  });

  it("a drop on nothing, or on an unknown card, does nothing", () => {
    mount();
    captured.props!.onDragEnd(drag("par", null));
    captured.props!.onDragEnd(drag("par", "case:nope"));
    expect(onDrop).not.toHaveBeenCalled();
  });
});
