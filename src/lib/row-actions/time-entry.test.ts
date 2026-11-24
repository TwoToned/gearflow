import { describe, expect, it, vi } from "vitest";

import { buildTimeEntryActions, buildTimeEntryBulkActions, bulkEligibility } from "./time-entry";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const all = { onEdit: vi.fn(), onSubmit: vi.fn(), onApprove: vi.fn(), onQuery: vi.fn(), onOpenPerson: vi.fn(), onDelete: vi.fn() };
const row = (status: string) => ({ title: "Ana Ruiz · Fri 7 Nov", status });

describe("buildTimeEntryActions", () => {
  it("offers exactly the verbs the server's transition table allows", () => {
    expect(keys(buildTimeEntryActions(row("DRAFT"), all))).toEqual(["edit", "submit", "person", "delete"]);
    expect(keys(buildTimeEntryActions(row("SUBMITTED"), all))).toEqual(["edit", "approve", "query", "person", "delete"]);
    expect(keys(buildTimeEntryActions(row("APPROVED"), all))).toEqual(["edit", "query", "person", "delete"]);
    expect(keys(buildTimeEntryActions(row("DISPUTED"), all))).toEqual(["edit", "submit", "approve", "person", "delete"]);
  });

  it("an Exported entry is locked: no menu at all", () => {
    expect(buildTimeEntryActions(row("EXPORTED"), all).items).toEqual([]);
  });

  it("Delete is last, red and confirmed", () => {
    const del = buildTimeEntryActions(row("DRAFT"), all).items.at(-1)!;
    expect(del.danger).toBe(true);
    expect(del.confirm?.confirmLabel).toBe("Delete entry");
    expect(del.confirm?.title).toContain("Ana Ruiz");
  });

  it("an omitted handler makes the verb ABSENT, not disabled", () => {
    expect(keys(buildTimeEntryActions(row("SUBMITTED"), {}))).toEqual([]);
    expect(keys(buildTimeEntryActions(row("SUBMITTED"), { onOpenPerson: vi.fn() }))).toEqual(["person"]);
  });

  it("Query… is spelled with the ellipsis (it asks for a reason)", () => {
    const q = buildTimeEntryActions(row("SUBMITTED"), all).items.find((i) => i.key === "query")!;
    expect(q.label).toBe("Query…");
  });
});

describe("buildTimeEntryBulkActions", () => {
  const ctx = { onApprove: vi.fn(), onSubmit: vi.fn(), onQuery: vi.fn(), onExport: vi.fn() };

  it("labels count the rows each verb would change, not the selection", () => {
    const acts = buildTimeEntryBulkActions(["SUBMITTED", "SUBMITTED", "DRAFT", "EXPORTED"], ctx);
    expect(acts.map((a) => a.label(4))).toEqual(["Approve 2", "Submit 1", "Query…", "Export"]);
  });

  it("a verb that would change nothing is absent; Export always applies", () => {
    expect(buildTimeEntryBulkActions(["EXPORTED"], ctx).map((a) => a.key)).toEqual(["export"]);
    expect(buildTimeEntryBulkActions(["APPROVED"], ctx).map((a) => a.key)).toEqual(["query", "export"]);
  });

  it("no handler, no verb", () => {
    expect(buildTimeEntryBulkActions(["SUBMITTED"], { onExport: vi.fn() }).map((a) => a.key)).toEqual(["export"]);
  });

  it("eligibility mirrors the from-states (DISPUTED can be submitted or approved)", () => {
    expect(bulkEligibility(["DISPUTED"])).toEqual({ submit: 1, approve: 1, query: 0 });
  });
});
