// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

import { FormSheet, type FormSheetProps } from "@/components/ui/form-sheet";

function open(over: Partial<FormSheetProps> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  const onAddAnother = vi.fn();
  render(
    <FormSheet
      open
      onOpenChange={onOpenChange}
      title="New asset"
      description="What it is and how you will find it."
      primaryLabel="Create asset"
      onSubmit={onSubmit}
      addAnother={{ label: "Save and add another", onSelect: onAddAnother }}
      footerStart={<button type="button">Import CSV…</button>}
      {...over}
    >
      <label>
        Tag
        <input defaultValue="AURA-01" />
      </label>
    </FormSheet>,
  );
  return { onSubmit, onOpenChange, onAddAnother };
}

describe("FormSheet", () => {
  beforeEach(() => {
    cleanup();
    mobile.value = false;
  });

  it("opens centred on desktop with the title, body and footer", () => {
    open();
    expect(screen.getByRole("dialog", { name: "New asset" })).toBeTruthy();
    expect(screen.getByLabelText("Tag")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create asset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and add another" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import CSV…" })).toBeTruthy();
    expect(document.querySelector('[data-slot="form-sheet"]')?.getAttribute("data-variant")).toBe("desktop");
  });

  it("is a full-height bottom sheet with a pinned footer on phone", () => {
    mobile.value = true;
    open();
    const sheet = document.querySelector('[data-slot="form-sheet"]') as HTMLElement;
    expect(sheet.getAttribute("data-variant")).toBe("phone");
    expect(sheet.className).toContain("h-[100dvh]");
    expect(document.querySelector('[data-slot="form-sheet-footer"]')).toBeTruthy();
  });

  it("submits through the one onSubmit, from the button and from Enter", async () => {
    const { onSubmit } = open();
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText("Tag"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("runs the add-another slot without submitting", async () => {
    const { onAddAnother, onSubmit } = open();
    await userEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(onAddAnother).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit while saving", async () => {
    const { onSubmit } = open({ submitting: true });
    await userEvent.type(screen.getByLabelText("Tag"), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes straight away when nothing changed (Cancel and Esc)", async () => {
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("asks before discarding a dirty form; Keep editing keeps the draft", async () => {
    const { onOpenChange } = open({ dirty: true });
    await userEvent.type(screen.getByLabelText("Tag"), "X");
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Discard your changes?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Tag") as HTMLInputElement).value).toBe("AURA-01X");
  });

  it("Discard closes the sheet", async () => {
    const { onOpenChange } = open({ dirty: true });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
