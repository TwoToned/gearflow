// @vitest-environment jsdom
//
// UX Phase 9 (D22): the job edit sheet opens from `?edit=1`, shows the shared
// ProjectFields with no Status field, keeps Save disabled until something
// changed, saves ONLY the changed fields, and runs the #1227 date-move gate
// (DateMoveImpactDialog over the sheet) only when the gear window moved on a
// Confirmed-or-later job.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const replace = vi.fn();
const update = vi.fn(async () => ({ id: "p1" }));
let project: Record<string, unknown>;
let impactRows: unknown[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  usePathname: () => "/projects/p1",
  useSearchParams: () => new URLSearchParams("edit=1&tab=equipment"),
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1" } } }),
}));
vi.mock("@/components/auth/permission-gate", () => ({ CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: (d: unknown) => Promise<unknown>; onSuccess?: (r: unknown) => void; onError?: (e: Error) => void }) => ({
    mutate: async (d: unknown) => {
      try { o.onSuccess?.(await o.mutationFn(d)); } catch (e) { o.onError?.(e as Error); }
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-project-detail", () => ({ useProjectDetail: () => ({ data: project, isLoading: false }) }));
vi.mock("@/hooks/use-native-project-writes", () => ({ useProjectWrites: () => ({ update }) }));
vi.mock("@/hooks/use-project-managers-writes", () => ({ useProjectManagerWrites: () => ({ set: vi.fn() }) }));
vi.mock("@/hooks/use-project-lock", () => ({
  useProjectPricingLock: () => ({ loading: false, pricingLocked: true, canUnlockPricing: false, lock: vi.fn(), unlock: vi.fn() }),
}));
vi.mock("@/hooks/use-clients", () => ({ useClientSearch: () => [], useClient: () => undefined, useClientContacts: () => [] }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (v: unknown) => v }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/server/org-members", () => ({ getOrgMembers: vi.fn(async () => ({ members: [] })) }));
vi.mock("@/server/projects", () => ({ peekNextProjectNumber: vi.fn(async () => "P-9") }));
vi.mock("@/components/clients/quick-create-client", () => ({ QuickCreateClient: () => null }));
vi.mock("@/components/assets/quick-create-location", () => ({ QuickCreateLocation: () => null }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({ rows: impactRows })) }),
}));

import { JobEditSheet } from "../job-edit-sheet";

const base = { id: "p1", projectNumber: "P-1", name: "Gala", type: "FESTIVAL", status: "CONFIRMED", tags: [], rentalStartDate: "2026-12-01", rentalEndDate: "2026-12-03", discountPercent: 10 };

beforeEach(() => {
  project = { ...base };
  impactRows = [];
  update.mockClear();
  replace.mockClear();
});

describe("JobEditSheet", () => {
  it("opens from ?edit=1 with the shared fields, no Status, and Save disabled until a change", async () => {
    render(<JobEditSheet projectId="p1" />);
    expect(await screen.findByText("Edit job")).toBeTruthy();
    expect(screen.getByText("Saving checks the new dates against gear on other jobs.")).toBeTruthy();
    expect(screen.queryByText("Status")).toBeNull();
    // Locked job: the Discount input is disabled with the lock hint.
    expect((screen.getByPlaceholderText("0").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("e.g. Summer Festival 2026"), { target: { value: "Gala 2" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("details changed")).toBeTruthy();
  });

  it("saves through the one update with the loaded values as `before`, then closes", async () => {
    render(<JobEditSheet projectId="p1" />);
    fireEvent.change(await screen.findByPlaceholderText("e.g. Summer Festival 2026"), { target: { value: "Gala 2" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [id, data, isTemplate, before] = update.mock.calls[0] as unknown as [string, { name: string }, boolean, { name: string }];
    expect(id).toBe("p1");
    expect(data.name).toBe("Gala 2");
    expect(isTemplate).toBe(false);
    expect(before.name).toBe("Gala");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects/p1?tab=equipment"));
  });

  it("moving the dates on a Confirmed job opens the heads-up dialog over the sheet; Save anyway saves", async () => {
    impactRows = [{ modelId: "m1", modelName: "Sennheiser EM4", qty: 2, projectNumbers: ["#2338"] }];
    render(<JobEditSheet projectId="p1" />);
    await screen.findByText("Edit job");
    fireEvent.click(screen.getByRole("button", { name: "1 week" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Moving these dates creates a shortage/)).toBeTruthy();
    expect(screen.getByText(/2 × Sennheiser EM4 — also booked on #2338/)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("a pre-Confirmed job saves a date move with no dialog", async () => {
    project = { ...base, status: "QUOTING" };
    impactRows = [{ modelId: "m1", modelName: "X", qty: 1, projectNumbers: ["#1"] }];
    render(<JobEditSheet projectId="p1" />);
    await screen.findByText("Edit job");
    fireEvent.click(screen.getByRole("button", { name: "1 week" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/creates a shortage/)).toBeNull();
  });

  it("renders nothing without ?edit=1 semantics for a template: no Money section", async () => {
    project = { ...base, isTemplate: true, status: "ENQUIRY" };
    render(<JobEditSheet projectId="p1" />);
    expect(await screen.findByText("Edit template")).toBeTruthy();
    expect(screen.queryByText("Discount (%)")).toBeNull();
  });
});
