// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockItems = [
  {
    id: "mci-1",
    sortOrder: 0,
    checkItem: {
      id: "ci-1",
      label: "Power on",
      description: null,
      type: "PASS_FAIL",
      category: null,
      measurementUnit: null,
      measurementMin: null,
      measurementMax: null,
      dropdownOptions: null,
    },
  },
  {
    id: "mci-2",
    sortOrder: 1,
    checkItem: {
      id: "ci-2",
      label: "Condition notes",
      description: null,
      type: "NOTES",
      category: null,
      measurementUnit: null,
      measurementMin: null,
      measurementMax: null,
      dropdownOptions: null,
    },
  },
  {
    id: "mci-4",
    sortOrder: 2,
    checkItem: {
      id: "ci-4",
      label: "No visible damage",
      description: null,
      type: "PASS_FAIL",
      category: null,
      measurementUnit: null,
      measurementMin: null,
      measurementMax: null,
      dropdownOptions: null,
    },
  },
  {
    id: "mci-5",
    sortOrder: 3,
    checkItem: {
      id: "ci-5",
      label: "Cables present",
      description: null,
      type: "PASS_FAIL",
      category: null,
      measurementUnit: null,
      measurementMin: null,
      measurementMax: null,
      dropdownOptions: null,
    },
  },
];

// Mutable so each await renderForm() can inject a different result set (e.g. the
// zero-items suite). Must be `mock`-prefixed to satisfy vitest's vi.mock hoist
// rule (the factory may only close over mock-prefixed outer bindings).
let mockCurrentItems: typeof mockItems = mockItems;

vi.mock("@/server/check-items", () => ({
  getModelCheckItems: vi.fn(async () => mockCurrentItems),
  getKitCheckItems: vi.fn(async () => mockCurrentItems),
}));

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org-1" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Sheet from shadcn/ui uses Base UI which pulls in portals + focus traps that
// are painful in jsdom. Replace with dumb passthroughs so the form content
// renders inline.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Select also uses Base UI portals — replace with a plain native-ish shim.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { ItemCheckForm } from "../item-check-form";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function renderForm(
  overrides: Partial<React.ComponentProps<typeof ItemCheckForm>> = {},
  seedData: typeof mockItems = mockItems
) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onOpenChange = vi.fn();
  const onPassAllRemaining = vi.fn();

  // The component reads check items through `useServerQuery`, which fetches via
  // the mocked server action in a mount effect. Point the mock at this test's
  // data set, then flush the resolving microtask so the rows are present.
  mockCurrentItems = seedData;

  const utils = render(
    <ItemCheckForm
      open
      onOpenChange={onOpenChange}
      modelId="model-1"
      assetTag="AST-1"
      assetName="Test asset"
      context="PREP"
      onSubmit={onSubmit}
      onCancel={onCancel}
      onPassAllRemaining={onPassAllRemaining}
      {...overrides}
    />
  );

  // Flush the useServerQuery effect (server action resolves → setState).
  await act(async () => {
    await Promise.resolve();
  });

  return { ...utils, onSubmit, onCancel, onOpenChange, onPassAllRemaining };
}

function key(k: string) {
  fireEvent.keyDown(document, { key: k });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ItemCheckForm keyboard shortcuts", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders check item labels", async () => {
    await renderForm();
    expect(screen.getByText("Power on")).toBeTruthy();
    expect(screen.getByText("No visible damage")).toBeTruthy();
  });

  it("P passes the focused PASS_FAIL row and auto-advances", async () => {
    const { onSubmit } = await renderForm();

    // Initial focus is on the first PASS_FAIL (index 0 — "Power on")
    key("p");
    // After auto-advance, focus is on index 3 ("No visible damage")
    key("p");
    // Focus is now on index 4 ("Cables present")
    key("p");

    // All three PASS_FAIL rows answered → Enter submits
    key("Enter");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [checks] = onSubmit.mock.calls[0];
    const byId = Object.fromEntries(
      (checks as CheckRecordFormValues[]).map((c) => [c.checkItemId, c.result])
    );
    expect(byId["ci-1"]).toBe("PASS");
    expect(byId["ci-4"]).toBe("PASS");
    expect(byId["ci-5"]).toBe("PASS");
  });

  it("F fails the focused PASS_FAIL row", async () => {
    const { onSubmit } = await renderForm();

    key("f"); // fail ci-1, auto-advance to ci-4
    key("p"); // pass ci-4, auto-advance to ci-5
    key("p"); // pass ci-5
    key("Enter");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [checks] = onSubmit.mock.calls[0];
    const byId = Object.fromEntries(
      (checks as CheckRecordFormValues[]).map((c) => [c.checkItemId, c.result])
    );
    expect(byId["ci-1"]).toBe("FAIL");
    expect(byId["ci-4"]).toBe("PASS");
    expect(byId["ci-5"]).toBe("PASS");
  });

  it("A passes all remaining PASS_FAIL rows", async () => {
    const { onSubmit } = await renderForm();

    key("a");
    key("Enter");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [checks] = onSubmit.mock.calls[0];
    const results = (checks as CheckRecordFormValues[]).filter((c) =>
      ["ci-1", "ci-4", "ci-5"].includes(c.checkItemId)
    );
    expect(results.every((r) => r.result === "PASS")).toBe(true);
  });

  it("ArrowDown moves cursor to next PASS_FAIL, skipping NOTES", async () => {
    const { onSubmit } = await renderForm();

    // Rows: [ci-1 PASS_FAIL, ci-2 NOTES, ci-4 PASS_FAIL, ci-5 PASS_FAIL]
    // Cursor starts at index 0 (ci-1). ArrowDown should skip ci-2 (NOTES)
    // and land on ci-4 (index 2). Press F to fail it.
    key("ArrowDown"); // now on ci-4
    key("f"); // fail ci-4, auto-advance to ci-5
    key("p"); // pass ci-5
    // ci-1 still unanswered → Enter should NOT submit
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();

    // Go back up and pass ci-1
    key("ArrowUp"); // back to ci-4
    key("ArrowUp"); // back to ci-1
    key("p");
    key("Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [checks] = onSubmit.mock.calls[0];
    const byId = Object.fromEntries(
      (checks as CheckRecordFormValues[]).map((c) => [c.checkItemId, c.result])
    );
    expect(byId["ci-1"]).toBe("PASS");
    expect(byId["ci-4"]).toBe("FAIL");
    expect(byId["ci-5"]).toBe("PASS");
  });

  it("Enter is a no-op when items are incomplete", async () => {
    const { onSubmit } = await renderForm();
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keyboard handler is inert when focus is inside a text input", async () => {
    const { onSubmit, container } = await renderForm();
    // NOTES row renders a textarea (ci-2)
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    textarea!.focus();
    fireEvent.keyDown(textarea!, { key: "p" });
    // No PASS_FAIL row should have been marked — Enter still does nothing
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("modifier keys let the browser handle the event", async () => {
    const { onSubmit } = await renderForm();
    fireEvent.keyDown(document, { key: "p", metaKey: true });
    fireEvent.keyDown(document, { key: "p", ctrlKey: true });
    // Row still unanswered → Enter no-op
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("isSubmitting disables keyboard shortcuts", async () => {
    const { onSubmit } = await renderForm({ isSubmitting: true });
    key("a");
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("embedded mode disables keyboard shortcuts", async () => {
    const { onSubmit } = await renderForm({ embedded: true });
    key("a");
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keyboard shortcuts detach when open goes false", async () => {
    const { onSubmit, rerender } = await renderForm();

    rerender(
      <ItemCheckForm
        open={false}
        onOpenChange={() => {}}
        modelId="model-1"
        assetTag="AST-1"
        assetName="Test asset"
        context="PREP"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    );

    key("a");
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// Regression: a model/kit with zero configured check items must NOT be
// submittable. Array.prototype.every returns true for an empty array, so before
// the `items.length > 0` guard the submit button was enabled and would POST an
// empty checks[] — which the server's `.min(1)` Zod schema rejects with an
// uncaught ZodError → 500. Items with no checks are meant to go through
// prepItemDirect, not this form.
describe("ItemCheckForm with zero check items", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders an empty-state message instead of check rows", async () => {
    await renderForm({}, []);
    expect(screen.getByText(/No check items are configured/i)).toBeTruthy();
    // None of the mockItems labels should render.
    expect(screen.queryByText("Power on")).toBeNull();
  });

  it("disables the submit button when no checks are configured", async () => {
    await renderForm({}, []);
    // PREP context with failCount === 0 → "Pack Item"
    const submit = screen.getByRole("button", { name: /Pack Item/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("does not call onSubmit when clicking submit with zero checks", async () => {
    const { onSubmit } = await renderForm({}, []);
    const submit = screen.getByRole("button", { name: /Pack Item/i });
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not call onSubmit on keyboard Enter with zero checks", async () => {
    const { onSubmit } = await renderForm({}, []);
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
