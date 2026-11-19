// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { floorJob, NOW, TODAY, DAY } from "@/lib/__tests__/floor-fixtures";

const mobile = { value: false };
const search = { value: "" };
const replace = vi.fn((href: string) => { search.value = href.split("?")[1] ?? ""; });
const push = vi.fn();
const setStatus = vi.fn();
const batchCloseOut = vi.fn(async (ids: string[]) => ids.map(() => ({ success: true })));
const query = vi.fn();

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ replace, push }),
  usePathname: () => "/warehouse",
}));
const setPackerM = vi.fn(async () => ({ previous: [{ id: "p1", packerUserId: null }] }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query }), useMutation: () => setPackerM }));
vi.mock("@/hooks/use-member-roster", () => ({
  useMemberRoster: () => ({ nameOf: new Map([["u2", "Kim Packer"]]), options: [{ id: "u2", name: "Kim Packer" }] }),
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Sam" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-native-project-writes", () => ({ useNativeProjectStatus: () => ({ updateStatus: setStatus }) }));
vi.mock("@/hooks/use-warehouse-close-writes", () => ({ useWarehouseCloseWrites: () => ({ batchCloseOut }) }));
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({ CameraScannerDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const jobs = [
  floorJob({ id: "p1", projectNumber: "2341", name: "Gala", status: "CONFIRMED", stage: "topick" }),
  floorJob({ id: "p2", projectNumber: "2342", name: "Tour", status: "CHECKED_OUT", stage: "out", projectEndDate: TODAY + DAY,
    counts: { lines: 1, linesToPick: 0, items: 3, packed: 0, out: 3, back: 0, damaged: 0, missing: 0 } }),
  floorJob({ id: "p3", projectNumber: "2343", name: "Expo", status: "RETURNED", stage: "returning", packerUserId: "u2",
    clientId: "c2", client: { name: "Beta" },
    counts: { lines: 1, linesToPick: 0, items: 2, packed: 0, out: 0, back: 2, damaged: 0, missing: 0 } }),
];
vi.mock("@/hooks/use-native-warehouse", () => ({ useNativeWarehouseList: () => ({ projects: jobs, isLoading: false }) }));

import { FloorPage } from "@/components/warehouse/floor/floor-page";

beforeEach(() => {
  mobile.value = false;
  search.value = "";
  vi.clearAllMocks();
});

describe("FloorPage (desktop)", () => {
  it("renders five derived columns with each job in its stage", () => {
    render(<FloorPage />);
    const board = screen.getByTestId("floor-board");
    expect(within(within(board).getByRole("region", { name: "To pick" })).getByText("Gala")).toBeTruthy();
    expect(within(within(board).getByRole("region", { name: "Out" })).getByText("Tour")).toBeTruthy();
    expect(within(within(board).getByRole("region", { name: "Returning" })).getByText("Expo")).toBeTruthy();
  });

  it("card ⋯ opens; Admin › Mark returned asks to confirm, then runs the one status write", async () => {
    render(<FloorPage />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for #2342" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Admin · ignores item state/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mark returned" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/3 items not returned yet/)).toBeTruthy();
    expect(setStatus).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark returned" }));
    expect(setStatus).toHaveBeenCalledWith("p2", "RETURNED");
  });

  it("Enter on a job number rings its card; a scope change goes through the URL", async () => {
    render(<FloorPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "2343{Enter}");
    expect(screen.getByText("#2343 · Expo")).toBeTruthy();
    expect(document.getElementById("floor-card-p3")?.getAttribute("data-ringed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(replace).toHaveBeenLastCalledWith("/warehouse?scope=all", { scroll: false });
  });

  it("a tag goes through scanLookup.resolve once and shows the info entry", async () => {
    query.mockResolvedValueOnce({ url: "/assets/registry/a1", label: "Asset SK-1", activity: [
      { projectId: "p1", projectNumber: "2341", projectName: "Gala", lineItemId: "l", state: "packed", quantity: 1 },
    ], guard: null });
    render(<FloorPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "SK-1{Enter}");
    expect(await screen.findByText("Asset SK-1 · packed for #2341")).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("FloorPage packer + filter words", () => {
  it("the card shows its packer (or no packer); ⋯ › Assign packer… writes once for that job", async () => {
    render(<FloorPage />);
    expect(screen.getByText("Kim Packer")).toBeTruthy();
    expect(screen.getAllByText("no packer").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Actions for #2341" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Assign packer…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kim Packer" }));
    expect(setPackerM).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_1", assignments: [{ id: "p1", packerUserId: "u2" }] }));
  });

  it("Client ▾ opens, and choosing one goes through the URL", async () => {
    render(<FloorPage />);
    await userEvent.click(screen.getByRole("button", { name: /^Client/ }));
    await userEvent.click(await screen.findByText("Beta"));
    expect(replace).toHaveBeenLastCalledWith("/warehouse?client=c2", { scroll: false });
  });

  it("a packer filter in the URL narrows the board", () => {
    search.value = "scope=all&packer=u2";
    render(<FloorPage />);
    expect(screen.getByText("Expo")).toBeTruthy();
    expect(screen.queryByText("Gala")).toBeNull();
  });
});

describe("FloorPage (phone)", () => {
  it("shows the stage strip and rows, and ticking a returned job portals the BulkBar with Close out", async () => {
    mobile.value = true;
    render(<FloorPage />);
    expect(screen.getByTestId("floor-phone-list")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Stage" })).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select #2343" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    expect(bar.closest("[class*='fixed']")?.parentElement).toBe(document.body);
    await userEvent.click(within(bar).getByRole("button", { name: "Close out 1" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close out" }));
    expect(batchCloseOut).toHaveBeenCalledWith(["p3"]);
  });
});
