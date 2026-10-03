// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContainerRail, type ContainerRailItem } from "./container-rail";

const containers: ContainerRailItem[] = [
  { id: "c1", label: "Case 12", unitCount: 3 },
  { id: "c2", label: "Tub A", parentContainerId: "c1", unitCount: 1 },
];

describe("ContainerRail smoke", () => {
  it("renders Loose first, one chip per container, and a New button", () => {
    render(
      <ContainerRail containers={containers} activeContainerId={null} onSelect={() => {}} onNew={() => {}} />,
    );
    expect(screen.getByText("Loose")).toBeTruthy();
    expect(screen.getByText("Case 12")).toBeTruthy();
    expect(screen.getByText("Tub A")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("marks exactly one chip active (aria-checked)", () => {
    render(
      <ContainerRail containers={containers} activeContainerId="c1" onSelect={() => {}} onNew={() => {}} />,
    );
    const radios = screen.getAllByRole("radio");
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("Case 12");
  });

  it("calls onSelect with the container id when a chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ContainerRail containers={containers} activeContainerId={null} onSelect={onSelect} onNew={() => {}} />,
    );
    fireEvent.click(screen.getByText("Case 12"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("calls onSelect(null) when Loose is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ContainerRail containers={containers} activeContainerId="c1" onSelect={onSelect} onNew={() => {}} />,
    );
    fireEvent.click(screen.getByText("Loose"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onNew when New is clicked", () => {
    const onNew = vi.fn();
    render(
      <ContainerRail containers={[]} activeContainerId={null} onSelect={() => {}} onNew={onNew} />,
    );
    fireEvent.click(screen.getByText("New"));
    expect(onNew).toHaveBeenCalled();
  });
});
