// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelection } from "./use-selection";

describe("useSelection", () => {
  it("starts with empty selection", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selectionSize).toBe(0);
  });

  it("select() sets a single item", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("li-1"));
    expect(result.current.isSelected("li-1")).toBe(true);
    expect(result.current.selectionSize).toBe(1);
  });

  it("select() clears previous selection", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("li-1"));
    act(() => result.current.select("li-2"));
    expect(result.current.isSelected("li-1")).toBe(false);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.selectionSize).toBe(1);
  });

  it("toggle() adds and removes items (Cmd-click)", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("li-1", true));
    expect(result.current.isSelected("li-1")).toBe(true);
    act(() => result.current.toggle("li-2", true));
    expect(result.current.isSelected("li-1")).toBe(true);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.selectionSize).toBe(2);
    act(() => result.current.toggle("li-1", true));
    expect(result.current.isSelected("li-1")).toBe(false);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.selectionSize).toBe(1);
  });

  it("selectTo() selects a range (Shift-click)", () => {
    const allIds = ["li-1", "li-2", "li-3", "li-4", "li-5"];
    const { result } = renderHook(() => useSelection());

    // First click sets the anchor
    act(() => result.current.select("li-1"));
    expect(result.current.selectionSize).toBe(1);

    // Shift-click to li-3 selects range 1-3
    act(() => result.current.selectTo("li-3", allIds));
    expect(result.current.isSelected("li-1")).toBe(true);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.isSelected("li-3")).toBe(true);
    expect(result.current.isSelected("li-4")).toBe(false);
    expect(result.current.isSelected("li-5")).toBe(false);
  });

  it("selectTo() without prior click selects only the target", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectTo("li-2", ["li-1", "li-2", "li-3"]));
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.selectionSize).toBe(1);
  });

  it("clearSelection() empties the set", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("li-1"));
    act(() => result.current.toggle("li-2", true));
    expect(result.current.selectionSize).toBe(2);
    act(() => result.current.clearSelection());
    expect(result.current.selectionSize).toBe(0);
  });

  it("selectAll() replaces the selection with exactly the given ids (select-all)", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("li-9")); // pre-existing, unrelated selection
    act(() => result.current.selectAll(["li-1", "li-2", "li-3"]));
    expect(result.current.selectionSize).toBe(3);
    expect(result.current.isSelected("li-1")).toBe(true);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.isSelected("li-3")).toBe(true);
    // The stale, non-listed id is dropped — it's a replace, not a merge.
    expect(result.current.isSelected("li-9")).toBe(false);
  });

  it("selectAll() then selectTo() extends a range from the last id", () => {
    const allIds = ["li-1", "li-2", "li-3", "li-4"];
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectAll(["li-1"]));
    act(() => result.current.selectTo("li-3", allIds));
    expect(result.current.isSelected("li-1")).toBe(true);
    expect(result.current.isSelected("li-2")).toBe(true);
    expect(result.current.isSelected("li-3")).toBe(true);
    expect(result.current.isSelected("li-4")).toBe(false);
  });
});
