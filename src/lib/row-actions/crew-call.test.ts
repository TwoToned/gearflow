import { describe, expect, it } from "vitest";

import { buildCrewCallActions, buildOpenCallActions, buildPlannerBulkActions, plannerBulkCounts } from "./crew-call";

const noop = () => {};
const all = { onOffer: noop, onConfirm: noop, onOpenJob: noop, onOpenPerson: noop, onCancel: noop };
const keys = (status: string) => buildCrewCallActions({ status, title: "Ana · #2341" }, all).items.map((i) => i.key);

describe("crew call ⋯ (verbs from the one transition table; absent, not disabled)", () => {
  it("offers what the call's status allows", () => {
    expect(keys("PENDING")).toEqual(["offer", "job", "person", "cancel"]);
    expect(keys("OFFERED")).toEqual(["offer", "job", "person", "cancel"]);
    expect(keys("ACCEPTED")).toEqual(["confirm", "job", "person", "cancel"]);
    expect(keys("CONFIRMED")).toEqual(["job", "person", "cancel"]);
    expect(keys("DECLINED")).toEqual(["job", "person"]);
    expect(keys("COMPLETED")).toEqual(["job", "person"]);
  });

  it("Offer and Cancel email, so both carry a confirm; Cancel is red and says who is told", () => {
    const items = buildCrewCallActions({ status: "OFFERED", title: "Ana" }, all).items;
    expect(items.find((i) => i.key === "offer")).toMatchObject({ label: "Resend offer", confirm: { confirmLabel: "Resend offer" } });
    const cancel = items.find((i) => i.key === "cancel")!;
    expect(cancel.danger).toBe(true);
    expect(cancel.confirm?.body).toMatch(/1 person has been offered or confirmed and will be emailed/);
  });

  it("no handler, no verb", () => {
    expect(buildCrewCallActions({ status: "PENDING", title: "x" }, { onOpenJob: noop }).items.map((i) => i.key)).toEqual(["job"]);
  });
});

describe("Needs crew row ⋯", () => {
  it("Offer to suggested is absent when nobody free has the role", () => {
    expect(buildOpenCallActions({ onOfferTo: noop, onOfferSuggested: noop, suggestedCount: 0, onOpenJob: noop }).items.map((i) => i.key)).toEqual(["offer-to", "job"]);
    expect(buildOpenCallActions({ onOfferTo: noop, onOfferSuggested: noop, suggestedCount: 2 }).items.map((i) => i.key)).toEqual(["offer-to", "suggested"]);
  });
});

describe("planner bulk bar", () => {
  const ctx = { onOffer: noop, onConfirm: noop, onOfferSuggested: noop, onCancel: noop };

  it("each label counts the calls it would change; Cancel is last and red", () => {
    const statuses = ["PENDING", "PENDING", "OFFERED", "ACCEPTED", "DECLINED", "CONFIRMED"];
    expect(plannerBulkCounts(statuses)).toEqual({ offer: 2, confirm: 1, cancel: 5 });
    const bar = buildPlannerBulkActions({ statuses, suggested: 0 }, ctx);
    expect(bar.map((a) => a.label(99))).toEqual(["Offer 2", "Confirm 1", "Cancel 5"]);
    expect(bar[2]).toMatchObject({ danger: true });
    expect(bar[2].confirm?.body).toMatch(/3 people have been offered or confirmed/);
    expect(bar[0].confirm?.title).toBe("Send 2 offers?");
    expect(bar[1].confirm).toBeUndefined(); // Confirm n has an Undo instead
  });

  it("open calls ticked: only Offer to suggested", () => {
    expect(buildPlannerBulkActions({ statuses: [], suggested: 3 }, ctx).map((a) => a.label(0))).toEqual(["Offer to suggested 3"]);
  });
});
