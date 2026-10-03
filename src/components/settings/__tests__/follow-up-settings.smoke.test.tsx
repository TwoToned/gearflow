// @vitest-environment jsdom
//
// Follow-up settings (FEATUREDOCS/82) — rendered and driven: switches default
// ON, turning one off stores `false`, back on deletes the key, and an offset
// returned to its default is deleted rather than stored.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FollowUpSettingsPanel } from "../follow-up-settings";
import { followUpSettingsSchema } from "@/lib/validations/org-settings";

describe("FollowUpSettingsPanel", () => {
  it("renders both loops ON and the default offsets for an untouched org", () => {
    render(<FollowUpSettingsPanel value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Quote follow-ups" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Invoice chasing" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("First follow-up") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Decide by") as HTMLInputElement).value).toBe("14");
  });

  it("records an opt-out as false and deletes it when switched back on", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FollowUpSettingsPanel value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Invoice chasing" }));
    expect(onChange).toHaveBeenLastCalledWith({ invoicesEnabled: false });
    rerender(<FollowUpSettingsPanel value={{ invoicesEnabled: false }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Invoice chasing" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("stores a tuned offset and deletes it at the default", () => {
    const onChange = vi.fn();
    render(<FollowUpSettingsPanel value={{ nextFollowUpBusinessDays: 3 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("First follow-up"), { target: { value: "4" } });
    expect(onChange).toHaveBeenLastCalledWith({ nextFollowUpBusinessDays: 3, firstFollowUpBusinessDays: 4 });
    fireEvent.change(screen.getByLabelText("Next follow-up"), { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

describe("followUpSettingsSchema", () => {
  it("accepts the stored shape and rejects out-of-bounds offsets and unknown keys", () => {
    expect(followUpSettingsSchema.safeParse({ quotesEnabled: false, firstFollowUpBusinessDays: 3, cutoverAt: 1 }).success).toBe(true);
    expect(followUpSettingsSchema.safeParse({ firstFollowUpBusinessDays: 0 }).success).toBe(false);
    expect(followUpSettingsSchema.safeParse({ decisionLeadDays: 91 }).success).toBe(false);
    expect(followUpSettingsSchema.safeParse({ chaseClients: true }).success).toBe(false);
  });
});
