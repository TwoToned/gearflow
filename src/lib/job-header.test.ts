import { describe, it, expect, vi } from "vitest";
import { jobHeaderProps, rentalDatesLabel, type JobHeaderInput } from "./job-header";

function input(over: Partial<JobHeaderInput> = {}): JobHeaderInput {
  const on = Object.fromEntries(
    [
      "advance", "useTemplate", "edit", "openDocument", "openLabel", "openCallSheet", "openTimeline", "openFinance",
      "openComments", "openWarehouse", "openRunsheet", "duplicate", "saveAsTemplate", "cancel", "remove", "unlock",
    ].map((k) => [k, vi.fn()]),
  ) as unknown as JobHeaderInput["on"];
  return {
    name: "Hilton gala",
    status: "CONFIRMED",
    isTemplate: false,
    can: { update: true, create: true },
    lock: null,
    blockingCount: 0,
    advancing: false,
    versionItem: null,
    labels: { "container-label": null, "kit-label": null, "item-label": null },
    on,
    ...over,
  };
}

const keys = (spec?: { items: { key: string }[] }) => spec?.items.map((i) => i.key) ?? [];

describe("jobHeaderProps", () => {
  it("title, status word from the shared map, Advance to the next stage", () => {
    const i = input({ status: "AWAITING_PAYMENT" });
    const p = jobHeaderProps(i);
    expect(p.title).toBe("Hilton gala");
    expect(p.status.label).toBe("Awaiting payment");
    expect(p.primary?.label).toBe("Advance to Confirmed");
    void p.primary?.onSelect();
    expect(i.on.advance).toHaveBeenCalledWith("CONFIRMED");
    expect(p.progress?.currentIndex).toBe(2);
    expect(p.phonePrimaryBelowProgress).toBe(true);
  });

  it("without project:update: no Advance, no Edit, no Cancel; Documents and the safe ⋯ items stay", () => {
    const p = jobHeaderProps(input({ can: { update: false, create: false } }));
    expect(p.primary).toBeUndefined();
    expect(p.onEdit).toBeUndefined();
    expect(keys(p.menu)).toEqual(["comments", "warehouse", "runsheet"]);
    expect(keys(p.documents).length).toBeGreaterThan(0);
  });

  it("⋯ follows §6b's order with the danger verb last; cancelled swaps Cancel for Delete and drops Advance", () => {
    const versionItem = { key: "versions", label: "Version v3 · Live", group: "organise" as const, onSelect: vi.fn() };
    const p = jobHeaderProps(input({ versionItem, blockingCount: 2 }));
    expect(keys(p.menu)).toEqual(["comments", "warehouse", "runsheet", "versions", "duplicate", "save-template", "cancel"]);
    expect(p.menu!.items[0].label).toBe("Comments & discussion · 2 blocking");
    const cancel = p.menu!.items.at(-1)!;
    expect(cancel).toMatchObject({ danger: true, confirm: { confirmLabel: "Cancel job" } });

    const c = jobHeaderProps(input({ status: "CANCELLED" }));
    expect(keys(c.menu).at(-1)).toBe("delete");
    expect(c.primary).toBeUndefined();
    expect(c.progress).toBeUndefined();
  });

  it("Documents never renders a quote or invoice; it points to Finance instead", () => {
    const i = input();
    const p = jobHeaderProps(i);
    const labels = p.documents!.items.map((d) => d.label);
    expect(labels).toEqual([
      "Manifest", "Pull slip", "Delivery docket", "Return sheet", "Case labels", "Kit labels", "Loose item labels",
      "Call sheet", "Job timeline", "Quote & invoice PDFs → Finance",
    ]);
    expect(labels.some((l) => /^(Quote|Invoice)$/.test(l))).toBe(false);
    p.documents!.items[0].onSelect();
    expect(i.on.openDocument).toHaveBeenCalledWith("manifest");
  });

  it("lock glyph: Unlock only for the server's audience, and the glyph never empties", () => {
    const lock = { headline: "Pricing locked", detail: "A quote has been sent by Bob.", canUnlockPricing: true };
    const p = jobHeaderProps(input({ lock }));
    expect(p.lock?.label).toBe("Pricing locked");
    expect(keys(p.lock?.menu)).toEqual(["unlock", "lock-finance"]);
    expect(p.lock?.menu.items[0].confirm?.confirmLabel).toBe("Unlock pricing");

    const noAudience = jobHeaderProps(input({ lock: { ...lock, canUnlockPricing: false } }));
    expect(keys(noAudience.lock?.menu)).toEqual(["lock-finance"]);
    const noUpdate = jobHeaderProps(input({ lock, can: { update: false, create: false } }));
    expect(keys(noUpdate.lock?.menu)).toEqual(["lock-finance"]);
    expect(jobHeaderProps(input()).lock).toBeUndefined();
  });

  it("a template: Template word, Use template primary, no progress, Documents or ⋯", () => {
    const p = jobHeaderProps(input({ isTemplate: true, status: "ENQUIRY" }));
    expect(p.status.label).toBe("Template");
    expect(p.primary?.label).toBe("Use template");
    expect(p.progress).toBeUndefined();
    expect(p.documents).toBeUndefined();
    expect(keys(p.menu)).toEqual([]);
    expect(jobHeaderProps(input({ isTemplate: true, can: { update: true, create: false } })).primary).toBeUndefined();
  });

  it("disables Advance while a move is in flight; no Advance past Completed", () => {
    expect(jobHeaderProps(input({ advancing: true })).primary?.disabled).toBe(true);
    expect(jobHeaderProps(input({ status: "INVOICED" })).primary).toBeUndefined();
  });
});

describe("rentalDatesLabel", () => {
  it("counts calendar days inclusively", () => {
    expect(rentalDatesLabel("2026-11-12T00:00:00", "2026-11-14T00:00:00")).toMatch(/ · 3 days$/);
    expect(rentalDatesLabel("2026-11-12T00:00:00", null)).toMatch(/ · 1 day$/);
    expect(rentalDatesLabel(null, null)).toBeNull();
    expect(rentalDatesLabel("garbage", null)).toBeNull();
  });
});
