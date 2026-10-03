// @vitest-environment jsdom
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccessorySelectionFields } from "@/components/projects/accessory-selection-fields";
import type { ModelAccessoryDetail } from "@/server/line-items";

const ACCESSORIES: ModelAccessoryDetail[] = [
  { id: "row-default", bulkAssetId: "ba-default", quantity: 1, inclusion: "DEFAULT", assetTag: "BA-DEF", modelName: "XLR Cable" },
  { id: "row-optional", bulkAssetId: "ba-optional", quantity: 2, inclusion: "OPTIONAL", assetTag: "BA-OPT", modelName: "Flight Case" },
];

function Harness({ initialSelection = {} as Record<string, boolean> }) {
  const [selection, setSelection] = useState<Record<string, boolean>>(initialSelection);
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  return (
    <AccessorySelectionFields
      accessories={ACCESSORIES}
      quantity={1}
      selection={selection}
      onSelectionChange={setSelection}
      excludeReasons={excludeReasons}
      onExcludeReasonsChange={setExcludeReasons}
    />
  );
}

describe("AccessorySelectionFields smoke", () => {
  it("renders DEFAULT accessories under Included and OPTIONAL under Optional", () => {
    render(<Harness />);
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getByText("XLR Cable")).toBeTruthy();
    expect(screen.getByText("Flight Case")).toBeTruthy();
  });

  it("a DEFAULT row defaults to checked, an OPTIONAL row defaults to unchecked", () => {
    render(<Harness />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0].getAttribute("aria-checked")).toBe("true");
    expect(checkboxes[1].getAttribute("aria-checked")).toBe("false");
  });

  it("unchecking a DEFAULT row opens the 'remove default accessory' reason dialog, blocked until a reason is typed", () => {
    render(<Harness />);
    const [defaultCheckbox] = screen.getAllByRole("checkbox");
    fireEvent.click(defaultCheckbox);

    expect(screen.getByText("Remove default accessory?")).toBeTruthy();
    const removeButton = screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement;
    expect(removeButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Client supplying their own" } });
    expect(removeButton.disabled).toBe(false);
    fireEvent.click(removeButton);

    // Dialog closes and the row now shows the recorded reason.
    expect(screen.queryByText("Remove default accessory?")).toBeNull();
    expect(screen.getByText(/Removed: Client supplying their own/)).toBeTruthy();
  });

  it("checking an OPTIONAL row is a plain toggle with no reason prompt", () => {
    render(<Harness />);
    const [, optionalCheckbox] = screen.getAllByRole("checkbox");
    fireEvent.click(optionalCheckbox);
    expect(screen.queryByText("Remove default accessory?")).toBeNull();
    expect(optionalCheckbox.getAttribute("aria-checked")).toBe("true");
  });

  it("re-checking a previously-excluded DEFAULT row clears its reason instantly, no dialog", () => {
    render(<Harness initialSelection={{ "row-default": false }} />);
    const [defaultCheckbox] = screen.getAllByRole("checkbox");
    expect(defaultCheckbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(defaultCheckbox);
    expect(screen.queryByText("Remove default accessory?")).toBeNull();
    expect(defaultCheckbox.getAttribute("aria-checked")).toBe("true");
  });

  it("renders nothing when there are no accessories", () => {
    const { container } = render(
      <AccessorySelectionFields
        accessories={[]}
        quantity={1}
        selection={{}}
        onSelectionChange={() => {}}
        excludeReasons={{}}
        onExcludeReasonsChange={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
