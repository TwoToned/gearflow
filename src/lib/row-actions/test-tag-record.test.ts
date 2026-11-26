import { describe, expect, it, vi } from "vitest";
import { buildTestTagActions, buildTestTagBulkActions, buildTestTagPageMenu, buildTestTagRecordActions } from "@/lib/row-actions/test-tag";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const fn = () => vi.fn();

describe("buildTestTagRecordActions", () => {
  it("an active item offers Retire only (Delete is never offered before Retire)", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "TT1", retired: false, onRetire: fn(), onReactivate: fn(), onDelete: fn() }))).toEqual(["retire"]);
  });

  it("a retired item offers Reactivate and Delete…, which is last, red and confirmed with what goes with it", () => {
    const spec = buildTestTagRecordActions({ testTagId: "TT1", retired: true, onRetire: fn(), onReactivate: fn(), onDelete: fn() });
    expect(keys(spec)).toEqual(["reactivate", "delete"]);
    const del = spec.items.at(-1)!;
    expect(del).toMatchObject({ danger: true, group: "danger" });
    expect(del.confirm?.title).toBe("Delete TT1?");
    expect(del.confirm?.body).toMatch(/every test recorded/);
  });

  it("Print label is offered first, for an active or a retired item, only when there is a handler", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: false, onPrintLabel: fn(), onRetire: fn() }))).toEqual(["print-label", "retire"]);
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: true, onPrintLabel: fn(), onReactivate: fn() }))).toEqual(["print-label", "reactivate"]);
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: false, onRetire: fn() }))).toEqual(["retire"]);
  });

  it("a verb with no handler (the caller cannot) is ABSENT, never disabled", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: false }))).toEqual([]);
    expect(keys(buildTestTagRecordActions({ testTagId: "T", retired: true, onDelete: fn() }))).toEqual(["delete"]);
  });
});

describe("14a-3b verbs", () => {
  it("Export report and Schedule… sit before Retire; Schedule… is absent on a retired item; each absent without its handler", () => {
    expect(keys(buildTestTagRecordActions({ testTagId: "TT1", retired: false, onExportReport: fn(), onSchedule: fn(), onRetire: fn() }))).toEqual(["export-report", "schedule", "retire"]);
    expect(keys(buildTestTagRecordActions({ testTagId: "TT1", retired: true, onExportReport: fn(), onSchedule: fn(), onReactivate: fn() }))).toEqual(["export-report", "reactivate"]);
    expect(keys(buildTestTagRecordActions({ testTagId: "TT1", retired: false, onRetire: fn() }))).toEqual(["retire"]);
  });

  it("the row menu, the bulk bar and the page menu drop what the caller cannot do", () => {
    expect(keys(buildTestTagActions({ onOpen: fn(), onSchedule: fn(), onExportReport: fn() }))).toEqual(["open", "schedule", "export-report"]);
    expect(keys(buildTestTagActions({ onOpen: fn() }))).toEqual(["open"]);
    expect(buildTestTagBulkActions({ onPrintTags: fn(), onSchedule: fn() }).map((a) => a.key)).toEqual(["print-tags", "schedule"]);
    expect(buildTestTagBulkActions({ onPrintTags: fn() }).map((a) => a.key)).toEqual(["print-tags"]);
    expect(keys(buildTestTagPageMenu({ onQuickTest: fn() }))).toEqual(["quick-test"]);
    expect(keys(buildTestTagPageMenu({ onReports: fn() }))).toEqual(["reports"]);
  });
});
