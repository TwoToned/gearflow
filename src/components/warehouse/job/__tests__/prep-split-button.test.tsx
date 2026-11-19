// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrepSplitButton, prepMenuFor, type PrepHandlers } from "@/components/warehouse/job/prep-split-button";

const handlers = (): PrepHandlers => ({
  withAccessories: vi.fn(), parentOnly: vi.fn(), accessoriesWithParent: vi.fn(),
  accessoriesIntoActive: vi.fn(), choose: vi.fn(), unpackParent: vi.fn(),
});

describe("Prep ▾", () => {
  it("label follows the selection (§9.5)", () => {
    const h = handlers();
    expect(prepMenuFor({ count: 0, parentUnits: 0, packedParents: 0, accessoryLines: 0 }, h).primary.disabled).toBe(true);
    expect(prepMenuFor({ count: 2, parentUnits: 8, packedParents: 0, accessoryLines: 0 }, h).primary.label).toBe("Prep 8");
    expect(prepMenuFor({ count: 2, parentUnits: 8, packedParents: 0, accessoryLines: 2 }, h).primary.label).toBe("Prep 8 + accessories");
    expect(prepMenuFor({ count: 1, parentUnits: 0, packedParents: 1, accessoryLines: 2 }, h).primary.label).toBe("Pack 2 accessories");
  });
  it("opens, and each item calls its handler once", async () => {
    const h = handlers();
    render(<PrepSplitButton selection={{ count: 1, parentUnits: 3, packedParents: 0, accessoryLines: 1 }} handlers={h} />);
    await userEvent.click(screen.getByLabelText("Prep options"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Parent only · accessories stay to pick" }));
    expect(h.parentOnly).toHaveBeenCalledTimes(1);
    expect(h.withAccessories).not.toHaveBeenCalled();
  });
  it("a packed parent offers Unpack parent and into-active", () => {
    const m = prepMenuFor({ count: 1, parentUnits: 0, packedParents: 1, accessoryLines: 1 }, handlers());
    expect(m.items.map((i) => i.key)).toEqual(["with-parent", "into-active", "choose", "unpack"]);
  });
});
