// @vitest-environment jsdom
/**
 * Smoke test for CustomItemAddForm — covers the % discount toggle added for
 * GitHub issue #883 (previously custom items only supported a flat $
 * discount at add-time, unlike every other add/edit form).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-line-item-writes", () => ({
  useLineItemWrites: () => ({
    enabled: true,
    addCustom: vi.fn(async () => ({ id: "new-id" })),
  }),
}));
vi.mock("@/hooks/use-project-detail", () => ({ refreshProjectDetail: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CustomItemAddForm } from "./custom-item-add-form";

describe("CustomItemAddForm", () => {
  it("renders the $/% discount toggle and previews a %-resolved total", () => {
    render(
      <CustomItemAddForm
        projectId="p1"
        categories={[]}
        onInvalidate={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Cable drum" } });
    fireEvent.change(screen.getByLabelText("Unit price ($)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });

    // Switch to % and set a 10% discount — gross is 100 x 2 x 1 (FLAT) = 200.
    fireEvent.click(screen.getByTitle("Switch to percentage"));
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });

    expect(screen.getByText("$180.00")).toBeTruthy();
  });

  it("submits the %-resolved discount as a flat dollar amount", async () => {
    const lineItemWrites = await import("@/hooks/use-line-item-writes");
    const addCustom = vi.fn(async (_projectId: string, data: { discount?: number }) => {
      void data;
      return { id: "new-id" };
    });
    vi.spyOn(lineItemWrites, "useLineItemWrites").mockReturnValue({
      enabled: true,
      addCustom,
    } as unknown as ReturnType<typeof lineItemWrites.useLineItemWrites>);

    render(
      <CustomItemAddForm
        projectId="p1"
        categories={[]}
        onInvalidate={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Cable drum" } });
    fireEvent.change(screen.getByLabelText("Unit price ($)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByTitle("Switch to percentage"));
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    expect(addCustom).toHaveBeenCalledTimes(1);
    const [, parsed] = addCustom.mock.calls[0]!;
    expect(parsed.discount).toBe(20);
  });
});
