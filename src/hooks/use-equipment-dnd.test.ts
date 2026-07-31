import { describe, test, expect } from "vitest";
import {
  buildContainerMap,
  resolveLineItemDragAction,
  type ContainerContext,
} from "./use-equipment-dnd";
import type { CategoryData, GroupData, LineItemData } from "@/components/projects/equipment-rows";

function li(id: string, extra: Partial<LineItemData> = {}): LineItemData {
  return {
    id,
    description: id,
    quantity: 1,
    unitPrice: null,
    lineTotal: null,
    isKitChild: false,
    ...extra,
  } as LineItemData;
}

function group(id: string, lineItems: LineItemData[]): GroupData {
  return {
    id,
    title: id,
    description: null,
    quantity: 1,
    price: null,
    discount: null,
    suggestedPrice: null,
    sortOrder: 0,
    lineItems,
  } as GroupData;
}

function category(
  id: string,
  opts: { standalone?: LineItemData[]; groups?: GroupData[] } = {},
): CategoryData {
  return {
    id,
    name: id,
    sortOrder: 0,
    groups: opts.groups ?? [],
    lineItems: opts.standalone ?? [],
  } as CategoryData;
}

describe("buildContainerMap", () => {
  test("indexes standalone category items, group items, and uncategorized items into containers", () => {
    const catA = category("catA", { standalone: [li("s1"), li("s2")] });
    const g1 = group("g1", [li("g1i1")]);
    const catB = category("catB", { groups: [g1] });
    const orphanGroup = group("og1", [li("og1i1")]);

    const ctx = buildContainerMap([catA, catB], [li("u1")], [orphanGroup]);

    expect(ctx.itemsByContainer.get("standalone:catA")).toEqual(["s1", "s2"]);
    expect(ctx.itemsByContainer.get("items:g1")).toEqual(["g1i1"]);
    expect(ctx.itemsByContainer.get("uncategorized-standalone")).toEqual(["u1"]);
    expect(ctx.itemsByContainer.get("items:og1")).toEqual(["og1i1"]);

    expect(ctx.containerOf.get("s1")).toBe("standalone:catA");
    expect(ctx.containerOf.get("g1i1")).toBe("items:g1");
    expect(ctx.containerOf.get("u1")).toBe("uncategorized-standalone");
    expect(ctx.containerOf.get("og1i1")).toBe("items:og1");

    expect(ctx.containerMeta.get("standalone:catA")).toEqual({ categoryId: "catA", groupId: null });
    expect(ctx.containerMeta.get("items:g1")).toEqual({ categoryId: "catB", groupId: "g1" });
    expect(ctx.containerMeta.get("uncategorized-standalone")).toEqual({ categoryId: null, groupId: null });
    expect(ctx.containerMeta.get("items:og1")).toEqual({ categoryId: null, groupId: "og1" });
  });

  test("excludes hidden rows (kit children, merge tombstones, sub-hire group parents) from every container", () => {
    const kitChild = li("kc", { isKitChild: true });
    const tombstone = li("tomb", { status: "CANCELLED" } as Partial<LineItemData>);
    const shParent = li("shp", { subHireGroupId: "shg1" } as Partial<LineItemData>);
    const real = li("real");
    const catA = category("catA", { standalone: [kitChild, tombstone, shParent, real] });

    const ctx = buildContainerMap([catA], [], []);

    expect(ctx.itemsByContainer.get("standalone:catA")).toEqual(["real"]);
    expect(ctx.containerOf.has("kc")).toBe(false);
    expect(ctx.containerOf.has("tomb")).toBe(false);
    expect(ctx.containerOf.has("shp")).toBe(false);
  });
});

describe("resolveLineItemDragAction", () => {
  function ctxFor(catA: CategoryData): ContainerContext {
    return buildContainerMap([catA], [], []);
  }

  test("same container, dropped on a sibling -> reorder with the sibling's index", () => {
    const catA = category("catA", { standalone: [li("a"), li("b"), li("c")] });
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "li-c",
      ctx: ctxFor(catA),
    });
    expect(action).toEqual({
      kind: "reorder",
      containerId: "standalone:catA",
      orderedIds: ["b", "c", "a"],
    });
  });

  test("different container, dropped on a sibling -> move with the resulting insert order", () => {
    const g1 = group("g1", [li("x"), li("y")]);
    const catA = category("catA", { standalone: [li("a")], groups: [g1] });
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "li-y",
      ctx: ctxFor(catA),
    });
    expect(action).toEqual({
      kind: "move",
      lineItemId: "a",
      fromContainerId: "standalone:catA",
      toContainerId: "items:g1",
      targetCategoryId: "catA",
      targetGroupId: "g1",
      resultingOrder: ["x", "a", "y"],
    });
  });

  test("different container, dropped on the empty container's own landing zone -> move, append order", () => {
    const g1 = group("g1", []);
    const catA = category("catA", { standalone: [li("a")], groups: [g1] });
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "items:g1",
      ctx: ctxFor(catA),
    });
    expect(action).toEqual({
      kind: "move",
      lineItemId: "a",
      fromContainerId: "standalone:catA",
      toContainerId: "items:g1",
      targetCategoryId: "catA",
      targetGroupId: "g1",
      resultingOrder: undefined,
    });
  });

  test("Drop Matrix: a line item onto a sub-hire group is blocked", () => {
    const catA = category("catA", { standalone: [li("a")] });
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "shg-1",
      ctx: ctxFor(catA),
    });
    expect(action.kind).toBe("blocked");
  });

  test("noop: dropped on itself, no over target, or an unresolvable active id", () => {
    const catA = category("catA", { standalone: [li("a")] });
    const ctx = ctxFor(catA);
    expect(resolveLineItemDragAction({ activeSortableId: "li-a", overSortableId: "li-a", ctx })).toEqual({ kind: "noop" });
    expect(resolveLineItemDragAction({ activeSortableId: "li-a", overSortableId: null, ctx })).toEqual({ kind: "noop" });
    expect(resolveLineItemDragAction({ activeSortableId: "grp-1", overSortableId: "li-a", ctx })).toEqual({ kind: "noop" });
    expect(resolveLineItemDragAction({ activeSortableId: "li-ghost", overSortableId: "li-a", ctx })).toEqual({ kind: "noop" });
  });
});
