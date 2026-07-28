/**
 * Renderer-level tests for gearflowTable.
 *
 * Covers the Project Group → kit-style rendering change: a synthetic
 * group row carries its members in `childLineItems`, and the renderer
 * draws the parent bold and indents the children. The harness in
 * `test-utils.ts` intercepts the page's draw calls so we can assert
 * font choice (`Helvetica-Bold` vs `Helvetica`) and x-position
 * relationships without producing a real PDF.
 */
import { describe, it, expect } from "vitest";
import { runTablePlugin, makeLineItem } from "./test-utils";
import {
  structureLineItems,
  type CategoryForStructuring,
} from "../structure-line-items";

describe("gearflowTable — Project Group rendering", () => {
  it("group parent with childLineItems renders the parent name in bold", async () => {
    const items = [
      makeLineItem({
        id: "group-1",
        groupName: "Band",
        groupTitle: "Drum Kit Mic Set",
        isGroupRow: true,
        quantity: 1,
        model: { name: "Drum Kit Mic Set" },
        childLineItems: [
          makeLineItem({
            id: "child-1",
            groupName: "Band",
            categoryName: "Microphones",
            model: { name: "e602 ii" },
          }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items);

    const parentDraw = calls.drawText.find(c => c.text === "Drum Kit Mic Set");
    expect(parentDraw).toBeDefined();
    expect(parentDraw?.fontName).toBe("Helvetica-Bold");
  });

  it("a non-group regular row renders in regular weight (control)", async () => {
    const items = [
      makeLineItem({
        id: "regular-1",
        groupName: "Band",
        model: { name: "e906" },
      }),
    ];

    const calls = await runTablePlugin(items);

    const draw = calls.drawText.find(c => c.text === "e906");
    expect(draw).toBeDefined();
    expect(draw?.fontName).toBe("Helvetica");
  });

  it("group members render indented below the parent row", async () => {
    const items = [
      makeLineItem({
        id: "group-1",
        groupName: "Band",
        groupTitle: "Drum Kit Mic Set",
        isGroupRow: true,
        quantity: 1,
        model: { name: "Drum Kit Mic Set" },
        childLineItems: [
          makeLineItem({
            id: "child-1",
            groupName: "Band",
            model: { name: "e602 ii" },
          }),
          makeLineItem({
            id: "child-2",
            groupName: "Band",
            model: { name: "e904" },
          }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items);

    const parent = calls.drawText.find(c => c.text === "Drum Kit Mic Set");
    const child1 = calls.drawText.find(c => c.text === "e602 ii");
    const child2 = calls.drawText.find(c => c.text === "e904");

    expect(parent).toBeDefined();
    expect(child1).toBeDefined();
    expect(child2).toBeDefined();

    // The renderer indents kit-style children by ~12pt past the parent's
    // text x. Assert children appear strictly to the right of the parent.
    expect(child1!.x).toBeGreaterThan(parent!.x);
    expect(child2!.x).toBeGreaterThan(parent!.x);

    // Children render below the parent on the page (PDF Y axis is
    // bottom-up, so "below" means smaller y).
    expect(child1!.y).toBeLessThan(parent!.y);
    expect(child2!.y).toBeLessThan(child1!.y);
  });

  it("group parent renders members in childLineItems order", async () => {
    const items = [
      makeLineItem({
        id: "group-1",
        groupName: "Band",
        groupTitle: "Band Monitoring",
        isGroupRow: true,
        quantity: 1,
        model: { name: "Band Monitoring" },
        childLineItems: [
          makeLineItem({ id: "first", model: { name: "e-835-S" } }),
          makeLineItem({ id: "second", model: { name: "Powerplay P2" } }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items);

    const idx = (text: string) =>
      calls.drawText.findIndex(c => c.text === text);

    expect(idx("Band Monitoring")).toBeGreaterThan(-1);
    expect(idx("e-835-S")).toBeGreaterThan(idx("Band Monitoring"));
    expect(idx("Powerplay P2")).toBeGreaterThan(idx("e-835-S"));
  });

  it("group row without childLineItems renders as a regular (non-bold) row", async () => {
    // Mirrors the collapse-mode case (quote/invoice): synthetic group
    // row is emitted but has no attached members. It should render
    // like any other line item, not bold like a kit parent.
    const items = [
      makeLineItem({
        id: "group-1",
        groupName: "Band",
        groupTitle: "Lighting Package",
        isGroupRow: true,
        quantity: 1,
        model: { name: "Lighting Package" },
        // childLineItems omitted — collapse mode
      }),
    ];

    const calls = await runTablePlugin(items);

    const draw = calls.drawText.find(c => c.text === "Lighting Package");
    expect(draw).toBeDefined();
    expect(draw?.fontName).toBe("Helvetica");
  });

  it("kit parent still renders bold with [Kit] prefix (regression: not broken by group changes)", async () => {
    const items = [
      makeLineItem({
        id: "kit-1",
        groupName: "[Kit] FOH Rack",
        kitId: "kit-id-1",
        quantity: 1,
        kit: { assetTag: "K-001", name: "FOH Rack" },
        model: { name: "FOH Rack" },
        childLineItems: [
          makeLineItem({
            id: "kc-1",
            isKitChild: true,
            kitId: "kit-id-1",
            model: { name: "DiGiCo SD12" },
          }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items);

    const parent = calls.drawText.find(c => c.text === "[Kit] FOH Rack");
    expect(parent).toBeDefined();
    expect(parent?.fontName).toBe("Helvetica-Bold");
  });

  it("delivery-docket: group row renders when ANY child is CHECKED_OUT", async () => {
    // Status filter must pass synthetic group rows through if at least
    // one child meets the criteria — otherwise the parent + all its
    // members would silently drop from the docket.
    const items = [
      makeLineItem({
        id: "g1",
        groupName: "Band",
        groupTitle: "Drum Kit Mic Set",
        isGroupRow: true,
        status: "CONFIRMED",
        quantity: 1,
        model: { name: "Drum Kit Mic Set" },
        childLineItems: [
          makeLineItem({ id: "deployed", status: "CHECKED_OUT", model: { name: "e602 ii (DEPLOYED)" } }),
          makeLineItem({ id: "pending", status: "CONFIRMED", model: { name: "e904 (NOT YET)" } }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items, {
      documentType: "delivery-docket",
      filterByStatus: ["CHECKED_OUT"],
    });

    // Group parent renders (passes filter via its CHECKED_OUT child)
    const parent = calls.drawText.find(c => c.text === "Drum Kit Mic Set");
    expect(parent).toBeDefined();
    expect(parent?.fontName).toBe("Helvetica-Bold");

    // CHECKED_OUT child renders; CONFIRMED child filtered by the
    // children-loop's own status filter (independent of the parent gate).
    const deployedChild = calls.drawText.find(c => c.text === "e602 ii (DEPLOYED)");
    const pendingChild = calls.drawText.find(c => c.text === "e904 (NOT YET)");
    expect(deployedChild).toBeDefined();
    expect(pendingChild).toBeUndefined();
  });

  it("delivery-docket: group row with NO checked-out children is dropped entirely", async () => {
    const items = [
      makeLineItem({
        id: "g1",
        groupName: "Band",
        groupTitle: "Drum Kit Mic Set",
        isGroupRow: true,
        status: "CONFIRMED",
        quantity: 1,
        model: { name: "Drum Kit Mic Set" },
        childLineItems: [
          makeLineItem({ id: "c1", status: "CONFIRMED", model: { name: "e602 ii" } }),
          makeLineItem({ id: "c2", status: "CONFIRMED", model: { name: "e904" } }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items, {
      documentType: "delivery-docket",
      filterByStatus: ["CHECKED_OUT"],
    });

    // Neither parent nor children render — nothing is checked out.
    expect(calls.drawText.find(c => c.text === "Drum Kit Mic Set")).toBeUndefined();
    expect(calls.drawText.find(c => c.text === "e602 ii")).toBeUndefined();
  });

  it("section header for the bucket renders above the group's contents", async () => {
    // The category bucket ("Band") becomes the section header. The
    // group row ("Drum Kit Mic Set") and its members render under it.
    const items = [
      makeLineItem({
        id: "group-1",
        groupName: "Band",
        groupTitle: "Drum Kit Mic Set",
        isGroupRow: true,
        quantity: 1,
        model: { name: "Drum Kit Mic Set" },
        childLineItems: [
          makeLineItem({ id: "c-1", model: { name: "e602 ii" } }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items);

    // The bucket label "Band" is drawn as a section header
    const sectionHeader = calls.drawText.find(c => c.text === "Band");
    expect(sectionHeader).toBeDefined();
    expect(sectionHeader?.fontName).toBe("Helvetica-Bold");

    // Group row appears below the section header.
    const groupRow = calls.drawText.find(c => c.text === "Drum Kit Mic Set");
    expect(groupRow).toBeDefined();
    expect(groupRow!.y).toBeLessThan(sectionHeader!.y);
  });
});

describe("gearflowTable — group header does not repeat on a continuation page (2026-07-28)", () => {
  const bandItems = [
    makeLineItem({ id: "b-1", groupName: "Band", model: { name: "e602 ii" } }),
    makeLineItem({ id: "b-2", groupName: "Band", model: { name: "e604" } }),
    makeLineItem({ id: "b-3", groupName: "Band", model: { name: "e906" } }),
  ];

  it("draws the header once on the page where the group starts (startIndex 0)", async () => {
    const calls = await runTablePlugin(bandItems, {}, { startIndex: 0 });

    expect(calls.drawText.filter(c => c.text === "Band")).toHaveLength(1);
  });

  it("does NOT redraw the header on a page that only continues the group", async () => {
    // Simulates a second page: item b-1 (globalIdx 1) already rendered on
    // page 1, so this page's slice starts at globalIdx 2 — mid-group.
    const calls = await runTablePlugin(bandItems, {}, { startIndex: 1 });

    expect(calls.drawText.filter(c => c.text === "Band")).toHaveLength(0);
    // The remaining items still render.
    expect(calls.drawText.some(c => c.text === "e604")).toBe(true);
    expect(calls.drawText.some(c => c.text === "e906")).toBe(true);
  });
});

// ─── #943 — derived billing weeks/days price breakdown ────────────────────

describe("gearflowTable — priceBreakdown rendering (#943)", () => {
  it("renders the formatted breakdown line under the description when showPricing is on", async () => {
    const items = [
      makeLineItem({
        id: "li-1",
        model: { name: "PAR Can" },
        unitPrice: 100,
        priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: false }),
      }),
    ];

    const calls = await runTablePlugin(items, { showPricing: true });

    const breakdown = calls.drawText.find(c => c.text === "1 wk @ $100.00");
    expect(breakdown).toBeDefined();
    // Renders below the description row.
    const description = calls.drawText.find(c => c.text === "PAR Can");
    expect(description).toBeDefined();
    expect(breakdown!.y).toBeLessThan(description!.y);
  });

  it("renders the capped-week label distinctly from the uncapped breakdown", async () => {
    const items = [
      makeLineItem({
        id: "li-1",
        model: { name: "PAR Can" },
        unitPrice: 100,
        priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: true }),
      }),
    ];

    const calls = await runTablePlugin(items, { showPricing: true });

    expect(calls.drawText.find(c => c.text === "charged as 1 wk (capped)")).toBeDefined();
  });

  it("shows both weeks-and-days terms when both are non-zero", async () => {
    const items = [
      makeLineItem({
        id: "li-1",
        model: { name: "PAR Can" },
        unitPrice: 120,
        priceBreakdown: JSON.stringify({ weeks: 2, days: 3, weeklyRate: 50, dailyRate: 10, capped: false }),
      }),
    ];

    const calls = await runTablePlugin(items, { showPricing: true });

    expect(calls.drawText.find(c => c.text === "2 wk @ $50.00 + 3 d @ $10.00")).toBeDefined();
  });

  it("renders nothing when showPricing is off, even with a stored breakdown", async () => {
    const items = [
      makeLineItem({
        id: "li-1",
        model: { name: "PAR Can" },
        unitPrice: 100,
        priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: false }),
      }),
    ];

    const calls = await runTablePlugin(items, { showPricing: false });

    expect(calls.drawText.find(c => c.text === "1 wk @ $100.00")).toBeUndefined();
  });

  it("renders nothing for a manually-priced line (no priceBreakdown stored)", async () => {
    const items = [
      makeLineItem({ id: "li-1", model: { name: "PAR Can" }, unitPrice: 15 }),
    ];

    const calls = await runTablePlugin(items, { showPricing: true });

    // Only the description itself draws — no second text row underneath it.
    const rowsForThisItem = calls.drawText.filter(c => c.text.includes("PAR Can") || c.text.includes("wk") || c.text.includes(" d @"));
    expect(rowsForThisItem).toHaveLength(1);
  });

  it("malformed priceBreakdown JSON renders nothing rather than throwing", async () => {
    const items = [
      makeLineItem({ id: "li-1", model: { name: "PAR Can" }, unitPrice: 15, priceBreakdown: "{not valid json" }),
    ];

    await expect(runTablePlugin(items, { showPricing: true })).resolves.toBeDefined();
  });
});

describe("gearflowTable — bold gated by showKitChildren (client-facing docs)", () => {
  it("a group parent is NOT bold when showKitChildren is off (quote/invoice)", async () => {
    const items = [
      makeLineItem({
        id: "group-1",
        isGroupRow: true,
        groupTitle: "Small PA Package",
        quantity: 1,
        model: { name: "Small PA Package" },
        childLineItems: [makeLineItem({ id: "child-1", model: { name: "K10.2" } })],
      }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showKitChildren: false });
    const parentDraw = calls.drawText.find((c) => c.text === "Small PA Package");
    expect(parentDraw).toBeDefined();
    expect(parentDraw?.fontName).toBe("Helvetica");
    // Its children are correctly hidden too.
    expect(calls.drawText.some((c) => c.text === "K10.2")).toBe(false);
  });

  it("an accessory parent is NOT bold when showKitChildren is off, even though its accessory is hidden", async () => {
    const items = [
      makeLineItem({
        id: "parent-1",
        model: { name: "EW-DX SKM" },
        childLineItems: [
          makeLineItem({ id: "acc-1", isKitChild: true, childKind: "ACCESSORY", model: { name: "AA Battery" } }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showKitChildren: false });
    const parentDraw = calls.drawText.find((c) => c.text === "EW-DX SKM");
    expect(parentDraw?.fontName).toBe("Helvetica");
    expect(calls.drawText.some((c) => c.text === "AA Battery")).toBe(false);
  });

  it("stays bold when showKitChildren is on (warehouse docs, control)", async () => {
    const items = [
      makeLineItem({
        id: "group-1",
        isGroupRow: true,
        groupTitle: "Small PA Package",
        quantity: 1,
        model: { name: "Small PA Package" },
        childLineItems: [makeLineItem({ id: "child-1", model: { name: "K10.2" } })],
      }),
    ];

    const calls = await runTablePlugin(items, { showKitChildren: true });
    const parentDraw = calls.drawText.find((c) => c.text === "Small PA Package");
    expect(parentDraw?.fontName).toBe("Helvetica-Bold");
  });
});

describe("gearflowTable — per-item Discount column (quote/invoice)", () => {
  it("renders the line's discount as a negative amount", async () => {
    const items = [
      makeLineItem({ id: "li-1", model: { name: "USB Pro DI" }, unitPrice: 20, lineTotal: 15, discount: 5 }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showPricing: true });
    expect(calls.drawText.some((c) => c.text === "-$5.00")).toBe(true);
  });

  it("renders '-' when the line has no discount", async () => {
    const items = [
      makeLineItem({ id: "li-1", model: { name: "USB Pro DI" }, unitPrice: 20, lineTotal: 20, discount: null }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showPricing: true });
    // The description "USB Pro DI" doesn't itself contain a bare "-", so any
    // standalone "-" draw call must be the discount cell's placeholder.
    expect(calls.drawText.some((c) => c.text === "-")).toBe(true);
    expect(calls.drawText.some((c) => c.text.startsWith("-$"))).toBe(false);
  });

  // #1012 — the column prints the discount the way it was ENTERED.
  it("renders a percentage when the line was discounted in % mode", async () => {
    const items = [
      makeLineItem({
        id: "li-1",
        model: { name: "USB Pro DI" },
        unitPrice: 20,
        quantity: 5,
        duration: 2,
        // 15% of the 200.00 gross.
        discount: 30,
        discountMode: "%",
        lineTotal: 170,
      }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showPricing: true });
    expect(calls.drawText.some((c) => c.text === "-15%")).toBe(true);
    expect(calls.drawText.some((c) => c.text === "-$30.00")).toBe(false);
  });

  it("falls back to the dollar amount for a pre-#1012 row with no stored mode", async () => {
    const items = [
      makeLineItem({ id: "li-1", model: { name: "USB Pro DI" }, unitPrice: 20, quantity: 5, duration: 2, discount: 30, lineTotal: 170 }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showPricing: true });
    expect(calls.drawText.some((c) => c.text === "-$30.00")).toBe(true);
    expect(calls.drawText.some((c) => c.text.endsWith("%"))).toBe(false);
  });

  it("falls back to the dollar amount when a % row has no gross to measure against", async () => {
    // A $0-priced line can't express its discount as a percentage — printing
    // "-Infinity%" / "-0%" would be worse than the amount it actually is.
    const items = [
      makeLineItem({ id: "li-1", model: { name: "USB Pro DI" }, unitPrice: 0, quantity: 1, duration: 1, discount: 5, discountMode: "%", lineTotal: 0 }),
    ];

    const calls = await runTablePlugin(items, { documentType: "quote", showPricing: true });
    expect(calls.drawText.some((c) => c.text === "-$5.00")).toBe(true);
  });

  it("renders a kit child's % discount as a percentage too", async () => {
    const items = [
      makeLineItem({
        id: "kit-1",
        kitId: "k1",
        model: { name: "Small PA Kit" },
        unitPrice: 100,
        lineTotal: 100,
        childLineItems: [
          makeLineItem({
            id: "child-1",
            isKitChild: true,
            model: { name: "K10.2" },
            unitPrice: 50,
            quantity: 2,
            duration: 1,
            discount: 20,
            discountMode: "%",
            lineTotal: 80,
          }),
        ],
      }),
    ];

    const calls = await runTablePlugin(items, {
      documentType: "quote",
      showPricing: true,
      showKitChildren: true,
    });
    expect(calls.drawText.some((c) => c.text === "-20%")).toBe(true);
  });
});

// CLAUDE.md's PDF rule: a DocumentLineItem shape change needs at least one test
// that runs the FULL pipeline, not just the plugin in isolation — a plugin-only
// assertion would pass even if structureLineItems never populated the new field.
describe("gearflowTable — discount entry mode end-to-end (#1012)", () => {
  it("a % -discounted Project Group prints as a percentage on a quote", async () => {
    const categories: CategoryForStructuring[] = [
      {
        id: "cat-1",
        name: "Lighting",
        sortOrder: 0,
        groups: [
          {
            id: "grp-1",
            title: "Lighting Package",
            description: null,
            sortOrder: 0,
            quantity: 2,
            price: 500,
            // 10% of the 1,000.00 bundle gross.
            discount: 100,
            discountMode: "%",
          },
        ],
      },
    ];

    const structured = structureLineItems([], categories);
    const calls = await runTablePlugin(structured, { documentType: "quote", showPricing: true });

    expect(calls.drawText.some((c) => c.text === "-10%")).toBe(true);
    expect(calls.drawText.some((c) => c.text === "-$100.00")).toBe(false);
    // The printed total still comes from the stored dollar amount — the mode is
    // display-only, so the percentage and the total agree by construction.
    expect(calls.drawText.some((c) => c.text === "$900.00")).toBe(true);
  });

  it("a $ -discounted Project Group still prints the dollar amount", async () => {
    const categories: CategoryForStructuring[] = [
      {
        id: "cat-1",
        name: "Lighting",
        sortOrder: 0,
        groups: [
          {
            id: "grp-1",
            title: "Lighting Package",
            description: null,
            sortOrder: 0,
            quantity: 2,
            price: 500,
            discount: 100,
            discountMode: "$",
          },
        ],
      },
    ];

    const structured = structureLineItems([], categories);
    const calls = await runTablePlugin(structured, { documentType: "quote", showPricing: true });

    expect(calls.drawText.some((c) => c.text === "-$100.00")).toBe(true);
    expect(calls.drawText.some((c) => c.text.endsWith("%"))).toBe(false);
  });
});
