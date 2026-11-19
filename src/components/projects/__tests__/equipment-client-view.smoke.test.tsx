// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";

const replace = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: new URLSearchParams("tab=equipment") }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/projects/p1",
  useSearchParams: () => params.current,
}));
const getEquipmentClientView = vi.hoisted(() => vi.fn());
vi.mock("@/server/equipment-client-view", () => ({ getEquipmentClientView }));

import { EquipmentClientView, EquipmentViewWords } from "../equipment-client-view";
import { useEquipmentClientView, useEquipmentViewParam } from "@/hooks/use-equipment-client-view";
import type { EquipmentClientView as ViewData } from "@/lib/equipment-client-view";

const VIEW: ViewData = {
  sections: [
    {
      key: "Lighting",
      title: "Lighting",
      rollupText: "$1,680.00",
      rows: [
        {
          id: "r1",
          name: "Source Four LED",
          subtitle: null,
          notes: null,
          qty: "4",
          unitPrice: "",
          discount: "",
          total: "",
          isOptional: true,
          priceHidden: true,
          children: [],
        },
      ],
    },
  ],
  totals: { subtotal: 1000, discountAmount: 0, taxAmount: 100, total: 1100 },
};

beforeEach(() => {
  vi.clearAllMocks();
  params.current = new URLSearchParams("tab=equipment");
});

describe("EquipmentViewWords", () => {
  it("presses the current word and reports the other", () => {
    const onChange = vi.fn();
    render(<EquipmentViewWords value="list" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Client view" }));
    expect(onChange).toHaveBeenCalledWith("client");
  });
});

describe("useEquipmentViewParam", () => {
  it("reads ?view=client and writes it back, keeping the other params", () => {
    const { result, rerender } = renderHook(() => useEquipmentViewParam());
    expect(result.current.value).toBe("list");
    act(() => result.current.set("client"));
    expect(replace).toHaveBeenCalledWith("/projects/p1?tab=equipment&view=client", { scroll: false });
    params.current = new URLSearchParams("tab=equipment&view=client");
    rerender();
    expect(result.current.value).toBe("client");
    act(() => result.current.set("list"));
    expect(replace).toHaveBeenLastCalledWith("/projects/p1?tab=equipment", { scroll: false });
  });
});

describe("EquipmentClientView", () => {
  it("renders the rows, the rollup, glyphs and the footer totals", () => {
    render(<EquipmentClientView view={VIEW} isLoading={false} error={null} onRetry={() => {}} versionNumber={2} />);
    // getBy* throws when absent.
    screen.getByText("Client view · v2 · as it prints");
    screen.getByText("$1,680.00");
    screen.getByLabelText("Optional · prints without counting");
    screen.getByLabelText("Price in the category's combined price");
    screen.getByLabelText("Totals");
    // Read-only: no add bar, selection or row menus.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/actions$/)).toBeNull();
  });

  it("shows a skeleton while loading and a retry on error", () => {
    const { rerender } = render(<EquipmentClientView view={undefined} isLoading error={null} onRetry={() => {}} />);
    screen.getByLabelText("Loading client view");
    const onRetry = vi.fn();
    rerender(<EquipmentClientView view={undefined} isLoading={false} error={new Error("x")} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("useEquipmentClientView", () => {
  it("fetches only while open, and re-reads (debounced) when the tab's data changes", async () => {
    vi.useFakeTimers();
    getEquipmentClientView.mockResolvedValue(VIEW);
    const { rerender } = renderHook((p: { enabled: boolean; source: unknown }) =>
      useEquipmentClientView({ projectId: "p1", versionId: "v3", enabled: p.enabled, source: p.source }),
    { initialProps: { enabled: false, source: 1 } });
    expect(getEquipmentClientView).not.toHaveBeenCalled();
    rerender({ enabled: true, source: 1 });
    await act(async () => {});
    expect(getEquipmentClientView).toHaveBeenCalledWith({ projectId: "p1", versionId: "v3" });
    rerender({ enabled: true, source: 2 });
    rerender({ enabled: true, source: 3 });
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(getEquipmentClientView).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
