// @vitest-environment jsdom
//
// WS2 (#941): the Schedule step's PROJECT window is soft (non-blocking) validated
// against the RENTAL window — projectStart should be <= rentalStart and
// projectEnd should be >= rentalEnd. A violation shows an inline hint but must
// NOT block Continue/submit (it's a "this is unusual" nudge, not a hard rule).
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

/** yyyy-MM-dd for `today + days`, using the REAL clock (no fake timers — RTL's
 *  async `findBy*` queries hang under vitest fake timers). */
function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1" } } }),
}));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-native-project-writes", () => ({
  useProjectWrites: () => ({ create: vi.fn(), update: vi.fn() }),
}));
vi.mock("@/hooks/use-project-managers-writes", () => ({
  useProjectManagerWrites: () => ({ set: vi.fn() }),
}));
vi.mock("@/hooks/use-project-lock", () => ({
  useProjectLockStatus: () => ({ loading: true, tier: "OPEN", hasOpenSession: false, canOverrideHardLock: false }),
}));
vi.mock("@/hooks/use-clients", () => ({
  useClientSearch: () => [],
  useClient: () => undefined,
  useClientContacts: () => [],
}));
vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: (v: unknown) => v,
}));
vi.mock("@/hooks/use-locations", () => ({
  useLocations: () => [],
}));
vi.mock("@/hooks/use-org-tags", () => ({
  useOrgTags: () => [],
}));
vi.mock("@/server/org-members", () => ({
  getOrgMembers: vi.fn(async () => ({ members: [] })),
}));
vi.mock("@/server/projects", () => ({
  peekNextProjectNumber: vi.fn(async () => "PROJ-0001"),
  checkProjectNumberAvailable: vi.fn(async () => ({ available: true })),
}));
vi.mock("@/components/clients/quick-create-client", () => ({
  QuickCreateClient: () => null,
}));
vi.mock("@/components/assets/quick-create-location", () => ({
  QuickCreateLocation: () => null,
}));

import { ProjectWizard } from "../project-wizard";

async function goToScheduleStep() {
  render(<ProjectWizard />);
  fireEvent.change(screen.getByPlaceholderText("e.g. Summer Festival 2026"), {
    target: { value: "Splendour Main Stage" },
  });
  fireEvent.change(screen.getByPlaceholderText(/PROJ-2026-0001/), {
    target: { value: "PROJ-0099" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  await screen.findByText(/Step 2: Schedule/);
}

describe("ProjectWizard schedule step — project window (WS2 #941)", () => {
  it("defaults the project window to blank with 'same as rental' ghost text", async () => {
    await goToScheduleStep();
    // The trigger's collapsed-state hint is always in the DOM; the calendar's own
    // "Same as rental window" summary only mounts once the disclosure is open.
    expect(screen.getByText(/\(same as rental\)/i)).toBeTruthy();
  });

  it("shows a non-blocking hint when the project window ends before the rental window, without blocking Continue", async () => {
    await goToScheduleStep();

    // Set a concrete rental window via the "1 week" preset (today .. today+6).
    fireEvent.click(screen.getByRole("button", { name: "1 week" }));

    // Open the Project window disclosure and set an end date BEFORE the rental end
    // ("1 week" = today..today+6) — today (+0) is always earlier.
    fireEvent.click(screen.getByRole("button", { name: /Project window/i }));
    fireEvent.change(screen.getByLabelText("Project ends date"), {
      target: { value: isoDateOffset(0) },
    });

    expect(
      screen.getByText(/project window ends before the rental window/i),
    ).toBeTruthy();

    // Non-blocking: Continue still works and advances past this step.
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await screen.findByText(/Step 3: Site/);
  });

  it("shows a non-blocking hint when the project window starts after the rental window", async () => {
    await goToScheduleStep();
    fireEvent.click(screen.getByRole("button", { name: "1 week" }));
    fireEvent.click(screen.getByRole("button", { name: /Project window/i }));
    fireEvent.change(screen.getByLabelText("Project starts date"), {
      target: { value: isoDateOffset(10) }, // well after today+6
    });

    expect(
      screen.getByText(/project window starts after the rental window/i),
    ).toBeTruthy();
  });
});
