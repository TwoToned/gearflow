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
