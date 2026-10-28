// @vitest-environment jsdom
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccessorySelectionFields } from "@/components/projects/accessory-selection-fields";
import type { CustomAccessoryInput } from "@/hooks/use-line-item-writes";

// A model with NO catalog accessories must still offer the custom row.
function Harness({ quantity = 2 }: { quantity?: number }) {
  const [custom, setCustom] = useState<CustomAccessoryInput[]>([]);
  return (
    <AccessorySelectionFields
      accessories={[]}
      quantity={quantity}
      selection={{}}
      onSelectionChange={() => {}}
      excludeReasons={{}}
      onExcludeReasonsChange={() => {}}
      custom={custom}
      onCustomChange={setCustom}
    />
  );
}

describe("custom accessory fields", () => {
  it("renders with no catalog accessories, and adds / scales / removes a custom accessory", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Custom accessory name"), { target: { value: "Gaffer tape" } });
    fireEvent.change(screen.getByLabelText("Custom accessory quantity per item"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    // 3 per item × line quantity 2.
    expect(screen.getByText("Gaffer tape")).toBeTruthy();
    expect(screen.getByText("6×")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove Gaffer tape"));
    expect(screen.queryByText("Gaffer tape")).toBeNull();
  });

  it("won't add a blank name", () => {
    render(<Harness />);
    const add = screen.getByRole("button", { name: /add/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });
});
