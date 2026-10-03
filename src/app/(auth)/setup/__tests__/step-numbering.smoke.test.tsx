// @vitest-environment jsdom
//
// Smoke test for the wizard's C4 screen (#1102): numbering/asset-tag/
// document-terms fields round-trip through updateOrganization merged with
// existing settings (D5), and — the behavioral deviation from every prior
// step — "Skip for now" is NOT a no-op here: an org with zero locations
// gets a "Main warehouse" default created even on skip, while an org that
// already has one gets nothing extra.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  updateOrganization: vi.fn(async () => ({})),
  getOrganization: vi.fn(async () => mocks.orgData),
  refreshOrganization: vi.fn(),
  createLocation: vi.fn(async () => ({ id: "loc1" })),
  orgData: {
    name: "Acme Productions",
    settings: { currency: "AUD", country: "AU" },
  } as Record<string, unknown>,
  locations: [] as unknown[] | undefined,
}));

vi.mock("@/server/settings", () => ({
  updateOrganization: mocks.updateOrganization,
  getOrganization: mocks.getOrganization,
}));
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: mocks.orgData, isLoading: false }),
  refreshOrganization: mocks.refreshOrganization,
}));
vi.mock("@/hooks/use-locations", () => ({
  useLocations: () => mocks.locations,
}));
vi.mock("@/hooks/use-location-writes", () => ({
  useLocationWrites: () => ({ create: mocks.createLocation }),
}));
// ProjectNumberingSettings/InvoiceNumberingSettings pull in their own
// useActiveOrganization + useServerQuery (live-preview) machinery, which is
// out of scope for this step's own test (they have their own coverage) —
// shimmed to plain controlled inputs, same shape as their real onChange.
vi.mock("@/components/settings/project-numbering-settings", () => ({
  ProjectNumberingSettings: ({
    format,
    onChange,
  }: {
    format: string;
    onChange: (patch: { format?: string }) => void;
  }) => (
    <input aria-label="Project number format" value={format} onChange={(e) => onChange({ format: e.target.value })} />
  ),
}));
vi.mock("@/components/settings/invoice-numbering-settings", () => ({
  InvoiceNumberingSettings: ({
    format,
    onChange,
  }: {
    format: string;
    onChange: (patch: { format?: string }) => void;
  }) => (
    <input aria-label="Invoice number format" value={format} onChange={(e) => onChange({ format: e.target.value })} />
  ),
}));

import { StepNumbering } from "../step-numbering";

beforeEach(() => {
  mocks.updateOrganization.mockClear();
  mocks.refreshOrganization.mockClear();
  mocks.createLocation.mockClear().mockResolvedValue({ id: "loc1" });
  mocks.orgData = { name: "Acme Productions", settings: { currency: "AUD", country: "AU" } };
  mocks.getOrganization.mockClear().mockImplementation(async () => mocks.orgData);
  mocks.locations = [];
});

describe("StepNumbering (smoke)", () => {
  it("'Skip for now' creates a default 'Main warehouse' location when the org has none, without writing settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepNumbering orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    await waitFor(() =>
      expect(mocks.createLocation).toHaveBeenCalledWith({ name: "Main warehouse", isDefault: true }),
    );
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("'Skip for now' creates nothing when the org already has a location", async () => {
    mocks.locations = [{ id: "existing" }];
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepNumbering orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.createLocation).not.toHaveBeenCalled();
  });

  it("'Skip for now' still advances even when the best-effort location creation fails", async () => {
    mocks.createLocation.mockRejectedValueOnce(new Error("Convex hiccup"));
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepNumbering orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("disables both buttons while the org's location list is still loading", async () => {
    mocks.locations = undefined;
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    const skip = (await screen.findByRole("button", { name: /skip for now/i })) as HTMLButtonElement;
    const save = screen.getByRole("button", { name: /save and continue/i }) as HTMLButtonElement;
    expect(skip.disabled).toBe(true);
    expect(save.disabled).toBe(true);
  });

  it("'Save and continue' writes numbering/asset-tag fields through updateOrganization merged with existing settings, creates the typed location, then calls onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepNumbering orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.type(await screen.findByLabelText("Project number format"), "%YY%MM%INC");
    await user.type(screen.getByLabelText("Prefix"), "GF-");
    await user.type(screen.getByLabelText("First location"), "Sydney warehouse");
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Acme Productions",
          settings: expect.objectContaining({
            currency: "AUD", // pre-existing field, not wiped by the patch
            country: "AU",
            projectNumberFormat: "%YY%MM%INC",
            assetTagPrefix: "GF-",
          }),
        }),
      ),
    );
    expect(mocks.createLocation).toHaveBeenCalledWith({ name: "Sydney warehouse", isDefault: true });
    expect(mocks.refreshOrganization).toHaveBeenCalledWith("org1");
    expect(onDone).toHaveBeenCalled();
  });

  it("'Save and continue' with an out-of-range payment-terms value is disabled", async () => {
    const user = userEvent.setup();
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    const input = await screen.findByLabelText("Payment terms (days)");
    await user.clear(input);
    await user.type(input, "9999");

    expect((screen.getByRole("button", { name: /save and continue/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves undefined documents when nothing was changed from defaults", async () => {
    const user = userEvent.setup();
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ documents: undefined }),
        }),
      ),
    );
  });

  it("merges onto a freshly re-fetched org, not the (possibly stale) cached one — closes the step-3-into-step-4 race", async () => {
    // The cached `useOrganization` snapshot this component displays from is
    // stale here (missing a branding field step 3 just saved), simulating
    // the window before step 3's fire-and-forget refreshOrganization
    // resolves. getOrganization() is the guaranteed-fresh read the save
    // path re-fetches — same fix shape as step-branding.tsx's saveBranding.
    mocks.orgData = { name: "Acme Productions", settings: { currency: "AUD", country: "AU" } };
    mocks.getOrganization.mockResolvedValue({
      name: "Acme Productions",
      settings: { currency: "AUD", country: "AU", branding: { documentColor: "#ff0000" } },
    });
    const user = userEvent.setup();
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ branding: { documentColor: "#ff0000" } }),
        }),
      ),
    );
  });

  it("preserves an existing documents field this screen doesn't expose (e.g. showTermsAndConditionsOnInvoice) rather than dropping it", async () => {
    mocks.orgData = {
      name: "Acme Productions",
      settings: {
        currency: "AUD",
        country: "AU",
        documents: { showTermsAndConditionsOnInvoice: true, footerSecondLine: "ABN 12 345 678 901" },
      },
    };
    const user = userEvent.setup();
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    // Touch a field this screen DOES expose, so buildDocumentsPatch has
    // something to write (an all-default save persists `documents: undefined`
    // — covered by the "saves undefined documents" test above).
    await user.type(await screen.findByLabelText("Footer text"), "Acme Productions");
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            documents: expect.objectContaining({
              showTermsAndConditionsOnInvoice: true,
              footerSecondLine: "ABN 12 345 678 901",
              footerText: "Acme Productions",
            }),
          }),
        }),
      ),
    );
  });

  it("rejects a fractional quote-validity value (server schema requires an integer)", async () => {
    const user = userEvent.setup();
    render(<StepNumbering orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    const input = await screen.findByLabelText("Quote validity (days)");
    await user.clear(input);
    await user.type(input, "30.5");

    expect((screen.getByRole("button", { name: /save and continue/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
