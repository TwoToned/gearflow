// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ search: "", docs: [] as unknown[] | undefined }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(h.search) }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));
vi.mock("@/hooks/use-saved-views-writes", () => ({
  useSavedViewWrites: () => ({
    create: vi.fn(async () => ({ id: "v9", name: "x" })),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/use-back-office", () => ({ useSavedTableViews: () => h.docs }));

import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { JOBS_SPEC, jobsBuiltInViews } from "@/lib/list-views/jobs";
import { defaultListState } from "@/lib/list-url-state";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const doc = (over: Record<string, unknown>) => ({
  id: "v1", organizationId: "org1", userId: "u1", tableId: "projects", name: "Mine", config: {}, isDefault: false, createdAt: 1, updatedAt: 1, ...over,
});
const builtIns = jobsBuiltInViews("u1");

function mount(setState = vi.fn()) {
  render(<UrlSavedViewsMenu tableId="projects" spec={JOBS_SPEC} state={defaultListState(JOBS_SPEC)} setState={setState} builtIns={builtIns} />);
  return setState;
}
function openMenu() {
  const trigger = screen.getByRole("button");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

beforeEach(() => {
  h.search = "";
  h.docs = [];
});

describe("UrlSavedViewsMenu", () => {
  it("opens and lists the built-ins; choosing one applies its query as list state", async () => {
    const setState = mount();
    openMenu();
    fireEvent.click(await screen.findByText("Unquoted enquiries"));
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][0].filters).toEqual({ status: ["ENQUIRY"] });
    expect(screen.queryByTitle("Delete view")).toBeNull(); // built-ins have no star/delete
  });

  it("converts a legacy stored row on read, so applying it sets the old filters and sort", async () => {
    h.docs = [doc({ config: { filters: { status: ["QUOTED"] }, sortBy: "name", sortOrder: "desc" } })];
    const setState = mount();
    openMenu();
    fireEvent.click(await screen.findByText("Mine"));
    const next = setState.mock.calls[0][0];
    expect(next.filters).toEqual({ status: ["QUOTED"] });
    expect([next.sortBy, next.sortOrder]).toEqual(["name", "desc"]);
  });

  it("applies the default only when the URL has no list params", async () => {
    h.docs = [doc({ isDefault: true, config: { query: "seg=booked" } })];
    const setState = mount();
    await waitFor(() => expect(setState).toHaveBeenCalledTimes(1));
    expect(setState.mock.calls[0][0].seg).toBe("booked");
  });

  it("does not apply the default over a URL that already carries list params", async () => {
    h.search = "status=QUOTED";
    h.docs = [doc({ isDefault: true, config: { query: "seg=booked" } })];
    const setState = mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(setState).not.toHaveBeenCalled();
  });

  it("'Save current view' opens the save dialog", async () => {
    mount();
    openMenu();
    fireEvent.click(await screen.findByText("Save current view…"));
    await waitFor(() => expect(screen.getByText("Make this my default view for this list")).toBeTruthy());
  });
});
