// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveToContainerDialog } from "./move-to-container-dialog";
import type { ContainerRailItem } from "./container-rail";

const containers: ContainerRailItem[] = [
  { id: "c1", label: "Case 12", unitCount: 3 },
  { id: "c2", label: "Tub A", unitCount: 1 },
];

describe("MoveToContainerDialog smoke", () => {
  it("renders Loose first and one option per container, with Move disabled until a target is picked", () => {
    render(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText("Loose")).toBeTruthy();
    expect(screen.getByText("Case 12")).toBeTruthy();
    expect(screen.getByText("Tub A")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the resolved unit count in the description", () => {
    render(
      <MoveToContainerDialog open unitCount={3} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText("Move 3 items into a different container.")).toBeTruthy();
  });

  it("disables Move entirely when nothing in the selection is move-able (unitCount 0), even after picking a target", () => {
    render(
      <MoveToContainerDialog open unitCount={0} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByText("Loose"));
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("picking a container enables Move and confirms with that container's id", () => {
    const onConfirm = vi.fn();
    render(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText("Case 12"));
    const moveButton = screen.getByRole("button", { name: "Move" });
    expect((moveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(moveButton);
    expect(onConfirm).toHaveBeenCalledWith("c1");
  });

  it("picking Loose confirms with null", () => {
    const onConfirm = vi.fn();
    render(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText("Loose"));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("Cancel calls onOpenChange(false) without confirming", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("resets the picked target each time it reopens", () => {
    const { rerender } = render(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByText("Case 12"));
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <MoveToContainerDialog open={false} unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    rerender(
      <MoveToContainerDialog open unitCount={2} containers={containers} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect((screen.getByRole("button", { name: "Move" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
