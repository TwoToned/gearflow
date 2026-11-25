// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  search: "edit-model=ghost",
  replace: vi.fn(),
  query: { data: null as unknown, isLoading: false, error: null as Error | null },
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/assets/models",
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => h.query }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/components/assets/model-sheet", () => ({
  ModelSheet: (p: { mode: string; stock?: { assets: number; bulk: number } }) => <div data-testid="sheet">{p.mode}:{p.stock?.assets ?? "-"}:{p.stock?.bulk ?? "-"}</div>,
}));

import { ModelSheetHost } from "@/components/assets/model-sheet-host";

describe("ModelSheetHost", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    h.search = "edit-model=ghost";
    h.query = { data: null, isLoading: false, error: null };
  });

  it("an unknown id drops the param and says so, with no empty sheet", async () => {
    render(<ModelSheetHost />);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Model not found"));
    expect(h.replace).toHaveBeenCalledWith("/assets/models", { scroll: false });
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("another organisation's id (the read throws) is treated the same", async () => {
    h.query = { data: undefined, isLoading: false, error: new Error("Forbidden") };
    render(<ModelSheetHost />);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Model not found"));
  });

  it("while loading nothing is said; a found model opens the sheet with only its ACTIVE units counted for the type lock", () => {
    h.query = { data: undefined, isLoading: true, error: null };
    const { rerender } = render(<ModelSheetHost />);
    expect(h.toastError).not.toHaveBeenCalled();
    h.query = {
      data: {
        id: "m1", name: "Aura",
        assets: [{ isActive: true }, { isActive: false }, {}],
        bulkAssets: [{ isActive: false }],
      },
      isLoading: false, error: null,
    };
    rerender(<ModelSheetHost />);
    expect(screen.getByTestId("sheet").textContent).toBe("edit:2:0");
  });
});
