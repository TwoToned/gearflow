// @vitest-environment jsdom
//
// Regression guard for #894 (R-8.1.7): the wizard's Continue/Back buttons
// unmount on step change, and without an explicit focus target the browser
// falls back to document.body — a silent focus loss for keyboard/screen-reader
// users. The fix lands focus on the new step's heading after every transition
// (except step 0, whose Name field already autoFocuses on mount).
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

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

describe("ProjectWizard (focus management, #894)", () => {
  it("moves focus to the new step's heading on Continue, instead of falling back to body", async () => {
    render(<ProjectWizard />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Summer Festival 2026"), {
      target: { value: "Splendour Main Stage" },
    });
    fireEvent.change(screen.getByPlaceholderText(/PROJ-2026-0001/), {
      target: { value: "PROJ-0099" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    const heading = await screen.findByText(/Step 2: Schedule/);
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not steal focus from the autoFocused Name field on initial render", () => {
    render(<ProjectWizard />);
    const nameInput = screen.getByPlaceholderText("e.g. Summer Festival 2026");
    expect(document.activeElement).toBe(nameInput);
  });
});
