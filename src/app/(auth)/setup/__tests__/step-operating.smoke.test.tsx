// @vitest-environment jsdom
//
// Smoke test for the wizard's C2 screen (#1099): picking a country auto-fills
// currency/timezone/tax label/tax rate (all still plain editable inputs —
// "auto-fill that hides itself reads as a bug"), the business-number field's
// LABEL tracks the country while its value is a normal input, "Skip for now"
// leaves without writing anything, and "Save and continue" writes through
// updateOrganization (the same server action Settings uses, D5) before
// calling onDone.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  updateOrganization: vi.fn(async () => ({})),
  refreshOrganization: vi.fn(),
  orgData: {
    name: "Acme Productions",
    settings: { currency: "AUD" },
    defaultTaxRate: 10,
  } as Record<string, unknown>,
}));

vi.mock("@/server/settings", () => ({
  updateOrganization: mocks.updateOrganization,
}));
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: mocks.orgData, isLoading: false }),
  refreshOrganization: mocks.refreshOrganization,
}));
// Radix Select's portal/pointer-capture behavior is unreliable in jsdom
// (see src/components/warehouse/__tests__/item-check-form.test.tsx's own
// comment on this) — shimmed as a native <select> so userEvent can drive it.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="Country"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" disabled>
        Select a country
      </option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));
// Google Places autocomplete needs an APIProvider ancestor this test doesn't
// set up — shim to a plain controlled input, same shape as every other
// AddressInput consumer's `value`/`onChange`.
vi.mock("@/components/ui/address-input", () => ({
  AddressInput: ({
    id,
    value,
    onChange,
    placeholder,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />,
}));

import { StepOperating } from "../step-operating";

beforeEach(() => {
  mocks.updateOrganization.mockClear();
  mocks.refreshOrganization.mockClear();
  mocks.orgData = { name: "Acme Productions", settings: { currency: "AUD" }, defaultTaxRate: 10 };
});

describe("StepOperating (smoke)", () => {
  it("auto-fills currency/timezone/tax label/tax rate when a country is picked", async () => {
    const user = userEvent.setup();
    render(<StepOperating orgId="org1" onDone={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText("Country"), "AU");

    expect(await screen.findByDisplayValue("AUD")).toBeTruthy();
    expect(screen.getByDisplayValue("Australia/Sydney")).toBeTruthy();
    expect(screen.getByDisplayValue("GST")).toBeTruthy();
    expect(screen.getByDisplayValue("10")).toBeTruthy();
    expect(screen.getByLabelText("ABN")).toBeTruthy();
  });

  it("leaves tax rate blank for the US — no invented default (#1088)", async () => {
    const user = userEvent.setup();
    render(<StepOperating orgId="org1" onDone={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText("Country"), "US");

    expect(await screen.findByDisplayValue("USD")).toBeTruthy();
    expect(screen.getByLabelText("EIN")).toBeTruthy();
    const taxRateInput = screen.getByLabelText("Tax rate (%)") as HTMLInputElement;
    expect(taxRateInput.value).toBe("");
    expect(taxRateInput.placeholder).toMatch(/no default/i);
  });

  it("'Skip for now' calls onDone without writing anything", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepOperating orgId="org1" onDone={onDone} />);

    await user.click(await screen.findByRole("button", { name: /skip for now/i }));

    expect(onDone).toHaveBeenCalled();
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("'Save and continue' writes through updateOrganization, merged with existing settings, then calls onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepOperating orgId="org1" onDone={onDone} />);

    await user.selectOptions(await screen.findByLabelText("Country"), "AU");
    await user.type(screen.getByLabelText("ABN"), "61 224 983 011");
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Acme Productions",
          settings: expect.objectContaining({
            currency: "AUD", // pre-existing field, not wiped by the patch
            country: "AU",
            taxLabel: "GST",
            abn: "61 224 983 011",
          }),
          defaultTaxRate: 10,
        }),
      ),
    );
    expect(mocks.refreshOrganization).toHaveBeenCalledWith("org1");
    expect(onDone).toHaveBeenCalled();
  });

  it("disables 'Save and continue' until a country is chosen", async () => {
    render(<StepOperating orgId="org1" onDone={vi.fn()} />);
    const button = (await screen.findByRole("button", {
      name: /save and continue/i,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("locks the country picker when the org already has one set (M6)", async () => {
    mocks.orgData = {
      name: "Acme Productions",
      settings: { currency: "AUD", country: "AU" },
      defaultTaxRate: 10,
    };
    render(<StepOperating orgId="org1" onDone={vi.fn()} />);
    const select = (await screen.findByLabelText("Country")) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("AU");
  });

  it("surfaces an error (not a false success) when the server silently keeps the existing country — never calls onDone", async () => {
    // Simulates the stale/duplicate-session case: the picker was somehow
    // enabled (or this ran before the lock existed) and a different country
    // was submitted than what's actually persisted. withImmutableCountry
    // forces it back server-side; the client must not treat that as success.
    mocks.updateOrganization.mockResolvedValue({ settings: { country: "AU" } });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<StepOperating orgId="org1" onDone={onDone} />);

    await user.selectOptions(await screen.findByLabelText("Country"), "US");
    await user.click(screen.getByRole("button", { name: /save and continue/i }));

    const select = (await screen.findByLabelText("Country")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("AU"));
    expect(select.disabled).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });
});
