import { describe, test, expect } from "vitest";
import {
  buildContainerMap,
  resolveLineItemDragAction,
  buildGroupContainerMap,
  resolveGroupDragAction,
  planGroupReorder,
  resolveCategoryDragAction,
  buildCategoryTopLevelOrder,
  computeDropZone,
  resolveCrossKindCategoryReorder,
  type ContainerContext,
  type GroupContainerContext,
} from "./use-equipment-dnd";
import type {
  CategoryData,
  GroupData,
  LineItemData,
  SubHireGroupData,
  MixedGroupSlot,
} from "@/components/projects/equipment-rows";

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

function subHireGroup(id: string): SubHireGroupData {
  return {
    id,
    title: id,
    quantity: 1,
    cost: null,
    charge: null,
    sortOrder: 0,
    targetCategoryId: null,
    subHire: { id: `sh-${id}`, orderNumber: "PO-1", status: "DRAFT" },
  } as SubHireGroupData;
}

function category(
  id: string,
  opts: {
    standalone?: LineItemData[];
    groups?: GroupData[];
    subHireGroupTargets?: SubHireGroupData[];
    mixedGroups?: MixedGroupSlot[];
  } = {},
): CategoryData {
  return {
    id,
    name: id,
    sortOrder: 0,
    groups: opts.groups ?? [],
    subHireGroupTargets: opts.subHireGroupTargets,
    mixedGroups: opts.mixedGroups,
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

  test("different container, dropped directly ON the group's own row -> move into that group, append order", () => {
    // Regression: dropping on the GROUP ROW itself (grp-g1), not one of its
    // child line items or the empty-container landing zone, used to resolve
    // to nothing (`resolveLineItemDropTarget` had no grp-/shg- branch) —
    // silently no-opping the drop back to its original position even though
    // the Drop Matrix allows a line item entering a project group.
    const g1 = group("g1", [li("x")]);
    const catA = category("catA", { standalone: [li("a")], groups: [g1] });
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "grp-g1",
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

  test("different container, dropped directly on ANOTHER CATEGORY's header row -> move to that category's standalone container, append order", () => {
    // Regression: dropping a line item on a category's header row (cat-*)
    // used to resolve to nothing (`resolveLineItemDropTarget` had no cat-
    // branch), silently no-opping the drag instead of moving the item to
    // that category's top level — the group-side equivalent already worked.
    const catA = category("catA", { standalone: [li("a")] });
    const catB = category("catB", { standalone: [li("b")] });
    const ctx = buildContainerMap([catA, catB], [], []);
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "cat-catB",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      lineItemId: "a",
      fromContainerId: "standalone:catA",
      toContainerId: "standalone:catB",
      targetCategoryId: "catB",
      targetGroupId: null,
      resultingOrder: undefined,
    });
  });

  test("different container, dropped on the Uncategorized zone's header/landing-zone row -> move, append order", () => {
    // Regression: with nothing currently uncategorized, equipment-tab.tsx
    // used to render no droppable at all for the Uncategorized zone — this
    // is the "uncat-zone" landing-zone row that now always renders.
    const catA = category("catA", { standalone: [li("a")] });
    const ctx = buildContainerMap([catA], [], []);
    const action = resolveLineItemDragAction({
      activeSortableId: "li-a",
      overSortableId: "uncat-zone",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      lineItemId: "a",
      fromContainerId: "standalone:catA",
      toContainerId: "uncategorized-standalone",
      targetCategoryId: null,
      targetGroupId: null,
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

describe("buildGroupContainerMap", () => {
  test("indexes a category's mixed project+sub-hire groups and the flat Uncategorized zone", () => {
    const catA = category("catA", {
      groups: [group("g1", []), group("g2", [])],
      subHireGroupTargets: [subHireGroup("sh1")],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "subHire", sortOrder: 1, subHireGroupId: "sh1" },
        { kind: "project", sortOrder: 2, projectGroupId: "g2" },
      ],
    });
    const orphanGroup = group("og1", []);
    const orphanSh = subHireGroup("osh1");

    const ctx = buildGroupContainerMap([catA], [orphanGroup], [orphanSh]);

    expect(ctx.itemsByContainer.get("mixed:catA")).toEqual(["grp-g1", "shg-sh1", "grp-g2"]);
    expect(ctx.itemsByContainer.get("uncategorized-groups")).toEqual(["grp-og1", "shg-osh1"]);

    expect(ctx.containerOf.get("grp-g1")).toBe("mixed:catA");
    expect(ctx.containerOf.get("shg-sh1")).toBe("mixed:catA");
    expect(ctx.containerOf.get("grp-og1")).toBe("uncategorized-groups");
    expect(ctx.containerOf.get("shg-osh1")).toBe("uncategorized-groups");

    expect(ctx.containerMeta.get("mixed:catA")).toEqual({ categoryId: "catA" });
    expect(ctx.containerMeta.get("uncategorized-groups")).toEqual({ categoryId: null });
  });

  test("falls back to cat.groups (project groups only) when mixedGroups is absent", () => {
    const catA = category("catA", { groups: [group("g1", []), group("g2", [])] });
    const ctx = buildGroupContainerMap([catA], [], []);
    expect(ctx.itemsByContainer.get("mixed:catA")).toEqual(["grp-g1", "grp-g2"]);
  });
});

describe("resolveGroupDragAction", () => {
  function groupCtxFor(catA: CategoryData, orphanGroups: GroupData[] = [], orphanSh: SubHireGroupData[] = []): GroupContainerContext {
    return buildGroupContainerMap([catA], orphanGroups, orphanSh);
  }

  test("same-category reorder, pure project groups (no sub-hire in the mix)", () => {
    const catA = category("catA", {
      groups: [group("g1", []), group("g2", []), group("g3", [])],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "project", sortOrder: 1, projectGroupId: "g2" },
        { kind: "project", sortOrder: 2, projectGroupId: "g3" },
      ],
    });
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "grp-g3",
      ctx: groupCtxFor(catA),
    });
    expect(action).toEqual({
      kind: "reorder",
      categoryId: "catA",
      orderedSortableIds: ["grp-g2", "grp-g3", "grp-g1"],
    });
  });

  test("same-category reorder, mixed list (a sub-hire group is in the mix, but the drop itself is same-kind — the Drop Matrix blocks a grp-/shg- direct hover, see the Drop Matrix tests below)", () => {
    const catA = category("catA", {
      groups: [group("g1", []), group("g2", [])],
      subHireGroupTargets: [subHireGroup("sh1")],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "subHire", sortOrder: 1, subHireGroupId: "sh1" },
        { kind: "project", sortOrder: 2, projectGroupId: "g2" },
      ],
    });
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "grp-g2",
      ctx: groupCtxFor(catA),
    });
    // The resulting order still carries the sub-hire group that was already
    // in the mix — this is what makes the caller's downstream
    // `planGroupReorder` pick the "mixed" (reorderMixed) branch instead of
    // the plain project-group reorder, even though THIS particular drag only
    // reordered two project groups past each other.
    expect(action).toEqual({
      kind: "reorder",
      categoryId: "catA",
      orderedSortableIds: ["shg-sh1", "grp-g2", "grp-g1"],
    });
  });

  test("cross-category move: dropped on a sibling group in a different category -> move with insert order", () => {
    const catA = category("catA", {
      groups: [group("g1", [])],
      mixedGroups: [{ kind: "project", sortOrder: 0, projectGroupId: "g1" }],
    });
    const catB = category("catB", {
      groups: [group("g2", []), group("g3", [])],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g2" },
        { kind: "project", sortOrder: 1, projectGroupId: "g3" },
      ],
    });
    const ctx = buildGroupContainerMap([catA, catB], [], []);
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "grp-g3",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      groupKind: "project",
      groupId: "g1",
      fromContainerId: "mixed:catA",
      toContainerId: "mixed:catB",
      targetCategoryId: "catB",
      resultingOrder: ["grp-g2", "grp-g1", "grp-g3"],
    });
  });

  test("move to Uncategorized: dropped on an orphan group -> move, no resultingOrder (zone isn't reorderable)", () => {
    const catA = category("catA", {
      groups: [group("g1", [])],
      mixedGroups: [{ kind: "project", sortOrder: 0, projectGroupId: "g1" }],
    });
    const orphanGroup = group("og1", []);
    const ctx = groupCtxFor(catA, [orphanGroup], []);
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "grp-og1",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      groupKind: "project",
      groupId: "g1",
      fromContainerId: "mixed:catA",
      toContainerId: "uncategorized-groups",
      targetCategoryId: null,
      resultingOrder: undefined,
    });
  });

  test("move from Uncategorized: an orphan sub-hire group dropped onto a category's (same-kind) sub-hire group -> move into that category", () => {
    // A sub-hire group can only be dropped directly onto ANOTHER sub-hire
    // group row (the Drop Matrix blocks shg- hovering a grp- row — see the
    // Drop Matrix tests below), so the destination category needs one to
    // land next to.
    const catA = category("catA", {
      groups: [group("g1", [])],
      subHireGroupTargets: [subHireGroup("sh-existing")],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "subHire", sortOrder: 1, subHireGroupId: "sh-existing" },
      ],
    });
    const orphanSh = subHireGroup("osh1");
    const ctx = groupCtxFor(catA, [], [orphanSh]);
    const action = resolveGroupDragAction({
      activeSortableId: "shg-osh1",
      overSortableId: "shg-sh-existing",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      groupKind: "subHire",
      groupId: "osh1",
      fromContainerId: "uncategorized-groups",
      toContainerId: "mixed:catA",
      targetCategoryId: "catA",
      resultingOrder: ["grp-g1", "shg-osh1", "shg-sh-existing"],
    });
  });

  test("cross-category move: dropped directly on the DESTINATION category's header row -> move, append order", () => {
    // Regression coverage for `resolveGroupDropTarget`'s cat- branch, which
    // existed before this test did but was never actually exercised.
    const catA = category("catA", {
      groups: [group("g1", [])],
      mixedGroups: [{ kind: "project", sortOrder: 0, projectGroupId: "g1" }],
    });
    const catB = category("catB", { groups: [], mixedGroups: [] });
    const ctx = buildGroupContainerMap([catA, catB], [], []);
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "cat-catB",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      groupKind: "project",
      groupId: "g1",
      fromContainerId: "mixed:catA",
      toContainerId: "mixed:catB",
      targetCategoryId: "catB",
      resultingOrder: undefined,
    });
  });

  test("move to Uncategorized via the zone's header/landing-zone row, even when nothing is uncategorized yet", () => {
    // Regression: with no existing orphan group to drop onto, the
    // Uncategorized zone previously had no droppable at all — this is the
    // "uncat-zone" landing-zone row that now always renders.
    const catA = category("catA", {
      groups: [group("g1", [])],
      mixedGroups: [{ kind: "project", sortOrder: 0, projectGroupId: "g1" }],
    });
    const ctx = groupCtxFor(catA);
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "uncat-zone",
      ctx,
    });
    expect(action).toEqual({
      kind: "move",
      groupKind: "project",
      groupId: "g1",
      fromContainerId: "mixed:catA",
      toContainerId: "uncategorized-groups",
      targetCategoryId: null,
      resultingOrder: undefined,
    });
  });

  test("no internal reorder within the Uncategorized zone", () => {
    const catA = category("catA", { groups: [] });
    const og1 = group("og1", []);
    const og2 = group("og2", []);
    const ctx = groupCtxFor(catA, [og1, og2], []);
    const action = resolveGroupDragAction({
      activeSortableId: "grp-og1",
      overSortableId: "grp-og2",
      ctx,
    });
    expect(action).toEqual({ kind: "noop" });
  });

  test("Drop Matrix: a project group onto a sub-hire group is blocked (no nested groups)", () => {
    const catA = category("catA", {
      groups: [group("g1", [])],
      subHireGroupTargets: [subHireGroup("sh1")],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "subHire", sortOrder: 1, subHireGroupId: "sh1" },
      ],
    });
    const action = resolveGroupDragAction({
      activeSortableId: "grp-g1",
      overSortableId: "shg-sh1",
      ctx: groupCtxFor(catA),
    });
    expect(action.kind).toBe("blocked");
  });

  test("Drop Matrix: a sub-hire group onto a project group is blocked (no nested groups)", () => {
    const catA = category("catA", {
      groups: [group("g1", [])],
      subHireGroupTargets: [subHireGroup("sh1")],
      mixedGroups: [
        { kind: "project", sortOrder: 0, projectGroupId: "g1" },
        { kind: "subHire", sortOrder: 1, subHireGroupId: "sh1" },
      ],
    });
    const action = resolveGroupDragAction({
      activeSortableId: "shg-sh1",
      overSortableId: "grp-g1",
      ctx: groupCtxFor(catA),
    });
    expect(action.kind).toBe("blocked");
  });

  test("noop: not a group id, dropped on itself, no over target, or an unresolvable active id", () => {
    const catA = category("catA", {
      groups: [group("g1", [])],
      mixedGroups: [{ kind: "project", sortOrder: 0, projectGroupId: "g1" }],
    });
    const ctx = groupCtxFor(catA);
    expect(resolveGroupDragAction({ activeSortableId: "li-a", overSortableId: "grp-g1", ctx })).toEqual({ kind: "noop" });
    expect(resolveGroupDragAction({ activeSortableId: "grp-g1", overSortableId: "grp-g1", ctx })).toEqual({ kind: "noop" });
    expect(resolveGroupDragAction({ activeSortableId: "grp-g1", overSortableId: null, ctx })).toEqual({ kind: "noop" });
    expect(resolveGroupDragAction({ activeSortableId: "grp-ghost", overSortableId: "grp-g1", ctx })).toEqual({ kind: "noop" });
  });
});

describe("planGroupReorder", () => {
  test("no sub-hire group in the list -> plain project-group reorder (bare ids)", () => {
    expect(planGroupReorder("catA", ["grp-g1", "grp-g2", "grp-g3"])).toEqual({
      kind: "pure",
      orderedIds: ["g1", "g2", "g3"],
    });
  });

  test("a sub-hire group in the list -> mixed reorder (pg-/shg- prefixed ids)", () => {
    expect(planGroupReorder("catA", ["grp-g1", "shg-sh1", "grp-g2"])).toEqual({
      kind: "mixed",
      categoryId: "catA",
      orderedIds: ["pg-g1", "shg-sh1", "pg-g2"],
    });
  });
});

describe("resolveCategoryDragAction", () => {
  const allCategorySortableIds = ["cat-a", "cat-b", "cat-c"];

  test("same position -> noop", () => {
    const action = resolveCategoryDragAction({
      activeSortableId: "cat-a",
      overSortableId: "cat-a",
      allCategorySortableIds,
    });
    expect(action).toEqual({ kind: "noop" });
  });

  test("dropped earlier in the list -> reorder", () => {
    const action = resolveCategoryDragAction({
      activeSortableId: "cat-c",
      overSortableId: "cat-a",
      allCategorySortableIds,
    });
    expect(action).toEqual({
      kind: "reorder",
      orderedIds: ["c", "a", "b"],
    });
  });

  test("dropped later in the list -> reorder", () => {
    const action = resolveCategoryDragAction({
      activeSortableId: "cat-a",
      overSortableId: "cat-c",
      allCategorySortableIds,
    });
    expect(action).toEqual({
      kind: "reorder",
      orderedIds: ["b", "c", "a"],
    });
  });

  test("noop: no over target, an unresolvable active id, or an unresolvable over id", () => {
    expect(
      resolveCategoryDragAction({ activeSortableId: "cat-a", overSortableId: null, allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveCategoryDragAction({ activeSortableId: "cat-ghost", overSortableId: "cat-a", allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveCategoryDragAction({ activeSortableId: "cat-a", overSortableId: "cat-ghost", allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
  });

  test("not a category id -> noop (line items and groups don't dispatch here)", () => {
    expect(
      resolveCategoryDragAction({ activeSortableId: "li-a", overSortableId: "cat-a", allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveCategoryDragAction({ activeSortableId: "grp-a", overSortableId: "cat-a", allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
  });

  test("dropped onto a non-category row -> noop (categories only reorder against each other)", () => {
    expect(
      resolveCategoryDragAction({ activeSortableId: "cat-a", overSortableId: "li-x", allCategorySortableIds }),
    ).toEqual({ kind: "noop" });
  });
});

describe("buildCategoryTopLevelOrder", () => {
  test("combines project groups, sub-hire groups, and standalone line items in slot order", () => {
    const catA = category("catA", {
      mixedGroups: [
        { kind: "subHire", sortOrder: 0, subHireGroupId: "shg1" },
        { kind: "lineItem", sortOrder: 1, lineItemId: "a" },
        { kind: "project", sortOrder: 2, projectGroupId: "g1" },
      ],
    });
    expect(buildCategoryTopLevelOrder([catA])).toEqual(
      new Map([["catA", ["shg-shg1", "li-a", "grp-g1"]]]),
    );
  });

  test("falls back to an empty order when mixedGroups is absent (HMR-stale cache)", () => {
    const catA = category("catA");
    expect(buildCategoryTopLevelOrder([catA])).toEqual(new Map([["catA", []]]));
  });
});

function rect(top: number, height: number) {
  return { top, height, left: 0, width: 100, right: 100, bottom: top + height };
}

describe("computeDropZone", () => {
  test("active centered in the top quarter of over's rect -> before", () => {
    // over spans y=0..100 (center 50); active center at y=10 -> relative 0.1
    expect(computeDropZone(rect(0, 20), rect(0, 100))).toBe("before");
  });

  test("active centered in the bottom quarter of over's rect -> after", () => {
    expect(computeDropZone(rect(80, 20), rect(0, 100))).toBe("after");
  });

  test("active centered in the middle half of over's rect -> middle", () => {
    expect(computeDropZone(rect(45, 10), rect(0, 100))).toBe("middle");
  });

  test("missing rect data falls back to middle (today's existing enter/reorder behaviour)", () => {
    expect(computeDropZone(null, rect(0, 100))).toBe("middle");
    expect(computeDropZone(rect(0, 20), null)).toBe("middle");
    expect(computeDropZone(rect(0, 20), rect(0, 0))).toBe("middle");
  });
});

describe("resolveCrossKindCategoryReorder", () => {
  const order = new Map([["catA", ["grp-g1", "li-a", "shg-shg1"]]]);

  test("middle drop zone -> noop (that's still 'enter', handled elsewhere)", () => {
    expect(resolveCrossKindCategoryReorder("li-a", "grp-g1", "middle", order)).toEqual({ kind: "noop" });
  });

  test("line item dropped on a group's top edge -> reorders it before the group", () => {
    expect(resolveCrossKindCategoryReorder("li-a", "grp-g1", "before", order)).toEqual({
      kind: "reorder",
      categoryId: "catA",
      orderedIds: ["li-a", "grp-g1", "shg-shg1"],
    });
  });

  test("group dropped on a line item's bottom edge -> reorders the group after it", () => {
    expect(resolveCrossKindCategoryReorder("grp-g1", "li-a", "after", order)).toEqual({
      kind: "reorder",
      categoryId: "catA",
      orderedIds: ["li-a", "grp-g1", "shg-shg1"],
    });
  });

  test("same-kind pairs (line-vs-line, group-vs-group) -> noop (unrelated resolvers own those)", () => {
    expect(resolveCrossKindCategoryReorder("li-a", "li-b", "before", order)).toEqual({ kind: "noop" });
    expect(resolveCrossKindCategoryReorder("grp-g1", "shg-shg1", "before", order)).toEqual({ kind: "noop" });
  });

  test("no-op when the result wouldn't change anything (already adjacent on that side)", () => {
    // "li-a" is already immediately before "shg-shg1" — dropping it "before" shg-shg1 again changes nothing.
    expect(resolveCrossKindCategoryReorder("li-a", "shg-shg1", "before", order)).toEqual({ kind: "noop" });
  });

  test("neither id in the same category's order -> noop", () => {
    expect(resolveCrossKindCategoryReorder("li-ghost", "grp-ghost", "before", order)).toEqual({ kind: "noop" });
  });
});
