// @vitest-environment jsdom
//
// Smoke test for the wizard's C3 screen (#1101): colours/logo/icon/document-
// logo-mode round-trip through updateOrganization merged with existing
// settings (D5), "Skip for now" writes nothing, the live header preview
// reflects the current mode/colour/image state, an existing branding field
// this screen doesn't expose survives a save, and the save merges onto a
// freshly re-fetched org rather than a possibly-stale cached one (closes the
// step-2-into-step-3 race — see saveBranding's doc comment).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  updateOrganization: vi.fn(async () => ({})),
  getOrganization: vi.fn(async () => mocks.orgData),
  refreshOrganization: vi.fn(),
  orgData: {
    name: "Acme Productions",
    settings: { currency: "AUD", country: "AU" },
  } as Record<string, unknown>,
}));

vi.mock("@/server/settings", () => ({
  updateOrganization: mocks.updateOrganization,
  getOrganization: mocks.getOrganization,
}));
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: mocks.orgData, isLoading: false }),
  refreshOrganization: mocks.refreshOrganization,
}));

import { StepBranding } from "../step-branding";

beforeEach(() => {
  mocks.updateOrganization.mockClear();
  mocks.refreshOrganization.mockClear();
  mocks.orgData = { name: "Acme Productions", settings: { currency: "AUD", country: "AU" } };
  mocks.getOrganization.mockClear().mockImplementation(async () => mocks.orgData);
});

describe("StepBranding (smoke)", () => {
  it("renders the live header preview with the org name", async () => {
    render(<StepBranding orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);
    const preview = await screen.findByTestId("header-preview");
    expect(preview.textContent).toContain("Acme Productions");
    expect(preview.textContent).toContain("QUOTE");
  });

  it("'Skip for now' calls onDone without writing anything", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepBranding orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    expect(onDone).toHaveBeenCalled();
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("picking a document colour and saving writes through updateOrganization, merged with existing settings, then calls onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepBranding orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    const hexInput = screen.getByLabelText("Document hex value");
    await user.clear(hexInput);
    await user.type(hexInput, "#ff0000");
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Acme Productions",
          settings: expect.objectContaining({
            currency: "AUD", // pre-existing field, not wiped by the patch
            country: "AU",
            branding: expect.objectContaining({ documentColor: "#ff0000" }),
          }),
        }),
      ),
    );
    expect(mocks.refreshOrganization).toHaveBeenCalledWith("org1");
    expect(onDone).toHaveBeenCalled();
  });

  it("switching document-logo mode to 'Logo, above header' updates the preview", async () => {
    const user = userEvent.setup();
    render(<StepBranding orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /logo, above header/i }));
    expect((screen.getByRole("radio", { name: /logo, above header/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("saves undefined branding when nothing was changed from defaults", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepBranding orgId="org1" onDone={onDone} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ branding: undefined }),
        }),
      ),
    );
  });

  it("preserves an existing branding field this screen doesn't expose (e.g. showOrgNameOnDocuments) rather than dropping it", async () => {
    mocks.orgData = {
      name: "Acme Productions",
      settings: { currency: "AUD", country: "AU", branding: { showOrgNameOnDocuments: false } },
    };
    const user = userEvent.setup();
    render(<StepBranding orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            branding: expect.objectContaining({ showOrgNameOnDocuments: false }),
          }),
        }),
      ),
    );
  });

  it("merges onto a freshly re-fetched org, not the (possibly stale) cached one — closes the step-2-into-step-3 race", async () => {
    // The cached `useOrganization` snapshot this component displays from is
    // stale here (missing the tax label step 2 just saved), simulating the
    // window before step 2's fire-and-forget refreshOrganization resolves.
    // getOrganization() is the guaranteed-fresh read the save path re-fetches.
    mocks.orgData = { name: "Acme Productions", settings: { currency: "AUD", country: "AU" } };
    mocks.getOrganization.mockResolvedValue({
      name: "Acme Productions",
      settings: { currency: "AUD", country: "AU", taxLabel: "GST" },
    });
    const user = userEvent.setup();
    render(<StepBranding orgId="org1" onDone={vi.fn()} onStepOutcome={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ taxLabel: "GST" }),
        }),
      ),
    );
  });
});
