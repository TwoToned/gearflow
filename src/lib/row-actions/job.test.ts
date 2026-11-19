import { describe, expect, it, vi } from "vitest";

import { buildJobActions, buildJobBulkActions, bulkStatusTargets } from "./job";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const all = { onSetStatus: vi.fn(), onDuplicate: vi.fn(), onSaveAsTemplate: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() };

describe("buildJobActions", () => {
  it("a live job: status, organise verbs, then a confirmed Cancel last; no Delete", () => {
    const spec = buildJobActions({ title: "Gig", status: "QUOTED" }, all);
    expect(keys(spec)).toEqual(["set-status", "duplicate", "template", "cancel"]);
    const cancel = spec.items.at(-1)!;
    expect(cancel.danger).toBe(true);
    expect(cancel.confirm?.confirmLabel).toBe("Cancel job");
  });

  it("Set status lists every hand-set status but the current one and Cancelled", () => {
    const kids = buildJobActions({ title: "Gig", status: "QUOTED" }, all).items[0].children!.map((c) => c.key);
    expect(kids).not.toContain("status-QUOTED");
    expect(kids).not.toContain("status-CANCELLED");
    expect(kids).toContain("status-CONFIRMED");
  });

  it("a cancelled job offers Delete (confirmed) and no Cancel or Set status", () => {
    const spec = buildJobActions({ title: "Gig", status: "CANCELLED" }, all);
    expect(keys(spec)).toEqual(["duplicate", "template", "delete"]);
    expect(spec.items.at(-1)!.confirm).toBeDefined();
  });

  it("an omitted handler makes the verb ABSENT, not disabled", () => {
    expect(keys(buildJobActions({ title: "Gig", status: "QUOTED" }, {}))).toEqual([]);
    expect(keys(buildJobActions({ title: "Gig", status: "QUOTED" }, { onDuplicate: vi.fn() }))).toEqual(["duplicate"]);
  });
});

describe("buildJobBulkActions", () => {
  it("labels carry the count and Cancel is a confirmed danger verb", () => {
    const acts = buildJobBulkActions({ onSetStatus: vi.fn(), onAddTag: vi.fn(), onExport: vi.fn(), onCancel: vi.fn() });
    expect(acts.map((a) => a.label(3))).toEqual(["Set status 3", "Add tag 3", "Export 3", "Cancel 3 jobs"]);
    expect(acts.at(-1)!.danger).toBe(true);
    expect(acts.at(-1)!.confirm).toBeDefined();
    expect(buildJobBulkActions({})).toEqual([]);
  });

  it("bulk Set status leaves Confirmed and Cancelled to the per-job flows", () => {
    expect(bulkStatusTargets()).not.toContain("CONFIRMED");
    expect(bulkStatusTargets()).not.toContain("CANCELLED");
    expect(bulkStatusTargets()).toContain("PREPPING");
  });
});
