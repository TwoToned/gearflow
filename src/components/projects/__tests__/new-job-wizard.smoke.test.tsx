// @vitest-environment jsdom
//
// UX Phase 9 (D24): the new job wizard. Three steps as words; the draft Enquiry is
// written once, at the first valid name (single-flight); the page ⋯ opens and
// `Discard draft…` asks first; `Create as enquiry` finishes from step one.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const push = vi.fn();
const create = vi.fn(async () => ({ id: "draft1" }));
const update = vi.fn(async () => ({ id: "draft1" }));
const discardDraft = vi.fn(async () => ({ outcome: "deleted" as const }));
const updateStatus = vi.fn(async () => {});
let lines: { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams("clientId=c9"),
  usePathname: () => "/projects/new",
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("@/hooks/use-projects", () => ({ useProject: (id?: string) => (id ? { id, projectNumber: "#2360", discountAmount: 0 } : undefined) }));
vi.mock("@/hooks/use-native-project-writes", () => ({
  useProjectWrites: () => ({ create, update, discardDraft }),
  useNativeProjectStatus: () => ({ updateStatus }),
}));
vi.mock("@/hooks/use-project-managers-writes", () => ({ useProjectManagerWrites: () => ({ set: vi.fn() }) }));
vi.mock("@/hooks/use-project-lock", () => ({ useProjectPricingLock: () => ({ loading: false, pricingLocked: false, canUnlockPricing: false }) }));
vi.mock("@/hooks/use-clients", () => ({ useClientSearch: () => [], useClient: () => undefined, useClientContacts: () => [] }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (v: unknown) => v }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-activation-milestones", () => ({ useActivationMilestones: () => undefined }));
vi.mock("@/hooks/use-native-equipment-tab", () => ({
  useNativeEquipmentTab: () => ({ uncategorizedItems: lines, categories: [], overbookedMap: {}, isLoading: false }),
}));
vi.mock("@/hooks/use-line-item-writes", () => ({ useLineItemWrites: () => ({ removeMany: vi.fn(), update: vi.fn() }) }));
vi.mock("@/server/org-members", () => ({ getOrgMembers: vi.fn(async () => ({ members: [] })) }));
vi.mock("@/server/projects", () => ({ peekNextProjectNumber: vi.fn(async () => "P-9") }));
vi.mock("@/components/clients/quick-create-client", () => ({ QuickCreateClient: () => null }));
vi.mock("@/components/assets/quick-create-location", () => ({ QuickCreateLocation: () => null }));
vi.mock("@/components/projects/equipment-add-bar", () => ({ EquipmentAddBar: ({ projectId }: { projectId: string }) => <div data-testid="add-bar">adding to {projectId}</div> }));

import { NewJobWizard } from "../new-job/new-job-wizard";

beforeEach(() => {
  [push, create, update, discardDraft, updateStatus].forEach((m) => m.mockClear());
  lines = [];
});

const NAME = "e.g. Summer Festival 2026";

describe("NewJobWizard", () => {
  it("shows the three step words and says the draft starts when the job is named", () => {
    render(<NewJobWizard />);
    expect(screen.getByRole("button", { name: "Who and when" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "What 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    expect(screen.getByText("Draft starts when you name the job")).toBeTruthy();
    // No Site step, no helper rail.
    expect(screen.queryByText(/So far/)).toBeNull();
    expect((screen.getByRole("button", { name: "What 0" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes ONE draft Enquiry at the first valid name, even when Next is pressed twice", async () => {
    render(<NewJobWizard />);
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Gala dinner" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-77" } });
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    fireEvent.click(next);
    await screen.findByText("adding to draft1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Gala dinner", status: "ENQUIRY", isTemplate: false }), expect.objectContaining({ id: expect.any(String), auditId: expect.any(String) }));
    expect(screen.getByText("✓ Draft #2360 saved")).toBeTruthy();
  });

  it("What shows the draft's lines with a quantity and the Equipment add bar; Review reads them out", async () => {
    lines = [{ id: "l1", description: "Barco UDX", quantity: 2, unitPrice: 500, lineTotal: 1000 }];
    render(<NewJobWizard />);
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Gala" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-78" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Barco UDX")).toBeTruthy();
    // The Equipment tab's own row: a select box and a ⋯ whose only item is the shared gear-line Delete.
    expect(screen.getByRole("checkbox", { name: /Barco UDX/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Hire \$1,000 · Discount \$0 · Total ex GST \$1,000/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Starts as" })).toBeTruthy();
  });

  it("there is no page ⋯ until a draft exists; then Discard draft… asks first and calls the ONE server verb", async () => {
    const user = userEvent.setup();
    render(<NewJobWizard />);
    expect(screen.queryByRole("button", { name: "Wizard actions" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Gala" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-79" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("adding to draft1");
    await user.click(await screen.findByRole("button", { name: "Wizard actions" }));
    await user.click(await screen.findByText("Discard draft…"));
    expect(await screen.findByText("Discard this draft?")).toBeTruthy();
    expect(discardDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith("draft1", expect.any(String), "discard"));
    // The id it sends is the audit id the create carried.
    const createdWith = (create.mock.calls[0] as unknown as [unknown, { auditId: string }])[1];
    expect((discardDraft.mock.calls[0] as unknown as [string, string, string])[1]).toBe(createdWith.auditId);
  });

  it("a retried create reuses the ids minted once for the draft", async () => {
    render(<NewJobWizard />);
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Gala" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-82" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("adding to draft1");
    const ids = (create.mock.calls[0] as unknown as [unknown, { id: string; auditId: string }])[1];
    expect(ids.id).toBeTruthy();
    expect(ids.auditId).toBeTruthy();
    expect(ids.id).not.toBe(ids.auditId);
  });

  it("a fresh-org create end to end: Next (draft written) → What → Next → Review → Create job lands on the job, and a double press on step one is ONE step", async () => {
    render(<NewJobWizard />);
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Fresh org job" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "E2E-1" } });
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    fireEvent.click(next); // the e2e's early second press: still step one, not Review
    await waitFor(() => expect(screen.getByRole("button", { name: "What 0" }).getAttribute("aria-current")).toBe("step"));
    expect(screen.queryByRole("button", { name: "Create job" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Create job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review" }).getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/draft1"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("pins the in-flight guard: pressing Next twice while the draft write is pending flushes exactly as often as pressing it once", async () => {
    /** Types a valid job, presses Next `presses` times while the create is pending, then lets it finish. */
    const run = async (presses: number) => {
      [create, update].forEach((m) => m.mockClear());
      let release: (v: { id: string }) => void = () => {};
      create.mockImplementationOnce(() => new Promise<{ id: string }>((r) => { release = r; }));
      const { unmount } = render(<NewJobWizard />);
      fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Slow draft" } });
      fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-90" } });
      for (let i = 0; i < presses; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      release({ id: "draft1" });
      await waitFor(() => expect(screen.getByRole("button", { name: "What 0" }).getAttribute("aria-current")).toBe("step"));
      const counts = { create: create.mock.calls.length, update: update.mock.calls.length };
      unmount();
      return counts;
    };
    const once = await run(1);
    const twice = await run(2);
    expect(once.create).toBe(1);
    expect(twice).toEqual(once); // an unguarded second press would queue another flush: one more update
  });

  it("Create as enquiry finishes the draft from step one without gear", async () => {
    render(<NewJobWizard />);
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "Quick one" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-80" } });
    fireEvent.click(screen.getByRole("button", { name: "Create as enquiry" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/draft1"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("honours ?clientId= once", async () => {
    render(<NewJobWizard />);
    // The client picker is a controlled combobox; the value is what the draft will carry.
    fireEvent.change(screen.getByPlaceholderText(NAME), { target: { value: "From client page" } });
    fireEvent.change(document.querySelector('input[name="projectNumber"]') as HTMLInputElement, { target: { value: "P-81" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c9" }), expect.anything()));
  });
});
