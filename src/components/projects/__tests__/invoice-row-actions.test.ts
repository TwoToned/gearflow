import { describe, it, expect, vi } from "vitest";

import { invoiceRowMenuActions } from "@/components/projects/finance/project-invoice-ledger";

/**
 * #1038 — unit coverage for the invoice row's overflow-menu logic (Delete
 * draft / Void / Delete permanently, #1055), extracted out of `InvoiceRow` so
 * the state × permission matrix is testable without mounting the full
 * Convex-wired panel.
 */
function handlers() {
  return { onDeleteDraft: vi.fn(), onVoidRequest: vi.fn(), onDeleteVoidRequest: vi.fn() };
}

describe("invoiceRowMenuActions", () => {
  it("offers Delete draft on a DRAFT invoice when permitted", () => {
    const actions = invoiceRowMenuActions(
      { id: "i1", status: "DRAFT", kind: "FULL", total: 100 },
      { canDelete: true, canVoid: true },
      handlers(),
    );
    expect(actions.map((a) => a.key)).toEqual(["delete-draft"]);
    expect(actions[0].destructive).toBe(true);
  });

  it("hides Delete draft on a DRAFT invoice without invoice:delete", () => {
    const actions = invoiceRowMenuActions(
      { id: "i1", status: "DRAFT", kind: "FULL", total: 100 },
      { canDelete: false, canVoid: true },
      handlers(),
    );
    expect(actions).toEqual([]);
  });

  it("offers Void on an ISSUED invoice when permitted", () => {
    const actions = invoiceRowMenuActions(
      { id: "i1", status: "ISSUED", kind: "FULL", total: 100 },
      { canDelete: true, canVoid: true },
      handlers(),
    );
    expect(actions.map((a) => a.key)).toEqual(["void"]);
  });

  it("offers Delete permanently on a VOID invoice when permitted (#1055)", () => {
    const actions = invoiceRowMenuActions(
      { id: "i1", status: "VOID", kind: "FULL", total: 100 },
      { canDelete: true, canVoid: true },
      handlers(),
    );
    expect(actions.map((a) => a.key)).toEqual(["delete-void"]);
    expect(actions[0].destructive).toBe(true);
  });

  it("hides Delete permanently on a VOID invoice without invoice:delete", () => {
    const actions = invoiceRowMenuActions(
      { id: "i1", status: "VOID", kind: "FULL", total: 100 },
      { canDelete: false, canVoid: true },
      handlers(),
    );
    expect(actions).toEqual([]);
  });
});
