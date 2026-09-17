// @vitest-environment jsdom
//
// R-8.8 — a smoke test that actually RENDERS the toast and CLICKS the Undo
// action, rather than asserting on the `toast.success(...)` call's props (the
// `/qa` lesson from `model-roi-tab.smoke.test.tsx`: asserting on props is what
// let the TooltipProvider crash class ship). Uses the real `sonner` Toaster,
// not a mock.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Toaster } from "@/components/ui/sonner";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";

// Same identity caveat as use-warehouse-writes.undo.test.ts: `api.*` is a
// fresh Proxy per access, so spies are keyed by the resolved function name.
const { spyFor, canDoMock } = vi.hoisted(() => {
  const FN_NAME = Symbol.for("functionName");
  const mutationSpies = new Map<string, ReturnType<typeof vi.fn>>();
  const spyFor = (ref: unknown): ReturnType<typeof vi.fn> => {
    const key = String((ref as Record<symbol, unknown>)[FN_NAME]);
    if (!mutationSpies.has(key)) mutationSpies.set(key, vi.fn());
    return mutationSpies.get(key)!;
  };
  return { spyFor, canDoMock: vi.fn((_resource: string, _action: string) => true) };
});

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => spyFor(ref),
  useConvex: () => ({ query: vi.fn(async () => null) }),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Ash" } } }),
  useActiveOrganization: () => ({ data: { id: "org-1" } }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCanDo: (resource: string, action: string) => canDoMock(resource, action),
}));

function DeployButton() {
  const writes = useWarehouseWrites();
  return (
    <div>
      <Toaster />
      <button onClick={() => void writes.checkOutItems("p1", [{ lineItemId: "li1" }])}>Deploy</button>
    </div>
  );
}

describe("useWarehouseWrites undo toast — smoke", () => {
  beforeEach(() => {
    // sonner keeps its toast queue in an external store outside the React
    // tree — remounting <Toaster/> between tests would otherwise still show
    // the previous test's toasts.
    toast.dismiss();
    canDoMock.mockReturnValue(true);
    spyFor(api.warehouseWrites.checkOutItems).mockResolvedValue({
      updatedLineIds: ["li1"],
      autoStatus: null,
      autoStatusAuditId: null,
    });
    spyFor(api.warehouseWrites.undeployItems).mockResolvedValue({ updatedLineIds: ["li1"] });
  });

  it("renders the toast with an Undo action and clicking it calls the reverse mutation", async () => {
    render(<DeployButton />);

    fireEvent.click(screen.getByText("Deploy"));

    await waitFor(() => expect(screen.getByText("Deployed 1 item")).toBeTruthy());
    const undoButton = await waitFor(() => screen.getByText("Undo"));

    fireEvent.click(undoButton);

    await waitFor(() => expect(spyFor(api.warehouseWrites.undeployItems)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Undone/)).toBeTruthy());
  });

  it("omits the Undo action entirely when the reverse permission is out of reach", async () => {
    canDoMock.mockImplementation((_resource: string, action: string) => action !== "check_in");
    render(<DeployButton />);

    fireEvent.click(screen.getByText("Deploy"));

    await waitFor(() => expect(screen.getByText("Deployed 1 item")).toBeTruthy());
    expect(screen.queryByText("Undo")).toBeNull();
  });
});
