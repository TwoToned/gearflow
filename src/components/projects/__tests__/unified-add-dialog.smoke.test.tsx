// @vitest-environment jsdom
//
// #1221 follow-up (parent #1221, FEATUREDOCS/78) — UnifiedAddDialog's
// segmented kind switcher is the ONE place that gates "Sale" while viewing
// a non-live version (own-stock/kit/custom-item are fully enabled now that
// their underlying CREATE mutations support a target versionId — see
// use-line-item-writes.test.ts for the hook-level proof of that
// passthrough). The five body forms (EquipmentAddForm/KitAddForm/
// CustomItemAddForm/SaleAddForm/SubHireAddForm) are heavy, deeply-queried
// components — mirroring equipment-add-menu-trigger.smoke.test.tsx's own
// reasoning, they're mocked out here so this test isolates exactly the one
// thing that changed: the switcher's disabled state.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/components/projects/equipment-add-form", () => ({
  EquipmentAddForm: (props: { versionId?: string }) => <div data-testid="body-own-stock">own-stock:{props.versionId ?? "live"}</div>,
}));
vi.mock("@/components/projects/kit-add-form", () => ({
  KitAddForm: (props: { versionId?: string }) => <div data-testid="body-kit">kit:{props.versionId ?? "live"}</div>,
}));
vi.mock("@/components/projects/custom-item-add-form", () => ({
  CustomItemAddForm: (props: { versionId?: string }) => <div data-testid="body-custom">custom:{props.versionId ?? "live"}</div>,
}));
vi.mock("@/components/projects/sale-add-form", () => ({
  SaleAddForm: () => <div data-testid="body-sale">sale</div>,
}));
vi.mock("@/components/projects/sub-hire-add-form", () => ({
  SubHireAddForm: () => <div data-testid="body-sub-hire">sub-hire</div>,
}));

import { UnifiedAddDialog, type UnifiedAddKind } from "@/components/projects/unified-add-dialog";

function Harness({ initialKind, versionId }: { initialKind: UnifiedAddKind; versionId?: string }) {
  const [kind, setKind] = React.useState<UnifiedAddKind>(initialKind);
  return (
    <UnifiedAddDialog
      open
      onOpenChange={() => {}}
      kind={kind}
      onKindChange={setKind}
      projectId="p1"
      categories={[]}
      onInvalidate={() => {}}
      onSubHireCreated={() => {}}
      versionId={versionId}
    />
  );
}

describe("UnifiedAddDialog — #1221 versionId follow-up", () => {
  it("live (no versionId): every tab, including Sale, is enabled", () => {
    render(<Harness initialKind="own-stock" />);
    const saleTab = screen.getByRole("tab", { name: "Sale" }) as HTMLButtonElement;
    expect(saleTab.disabled).toBe(false);
    expect(saleTab.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("non-live (versionId set): own-stock form receives it, Sale tab is disabled", () => {
    render(<Harness initialKind="own-stock" versionId="ver-2" />);
    // The mounted own-stock body got the version threaded through.
    expect(screen.getByTestId("body-own-stock").textContent).toBe("own-stock:ver-2");

    const saleTab = screen.getByRole("tab", { name: "Sale" }) as HTMLButtonElement;
    expect(saleTab.disabled).toBe(true);
    expect(saleTab.getAttribute("aria-disabled")).toBe("true");

    // Clicking the disabled tab does not switch the body to Sale.
    fireEvent.click(saleTab);
    expect(screen.queryByTestId("body-sale")).toBeNull();
    expect(screen.getByTestId("body-own-stock")).toBeTruthy();
  });

  it("kit body also receives the non-live versionId", () => {
    render(<Harness initialKind="kit" versionId="ver-2" />);
    expect(screen.getByTestId("body-kit").textContent).toBe("kit:ver-2");
  });

  it("custom-item body also receives the non-live versionId", () => {
    render(<Harness initialKind="custom" versionId="ver-2" />);
    expect(screen.getByTestId("body-custom").textContent).toBe("custom:ver-2");
  });

  it("reopening on a stale 'sale' kind while non-live falls back to own-stock instead of rendering a disabled tab's form", () => {
    render(<Harness initialKind="sale" versionId="ver-2" />);
    expect(screen.queryByTestId("body-sale")).toBeNull();
    expect(screen.getByTestId("body-own-stock")).toBeTruthy();
  });

  it("sub-hire stays reachable while non-live — it's a separate, never version-scoped table", () => {
    render(<Harness initialKind="sub-hire" versionId="ver-2" />);
    const subHireTab = screen.getByRole("tab", { name: "Sub-hire" }) as HTMLButtonElement;
    expect(subHireTab.disabled).toBe(false);
    expect(screen.getByTestId("body-sub-hire")).toBeTruthy();
  });
});
