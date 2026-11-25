import { describe, it, expect, vi } from "vitest";

import { invoiceRowMenuActions } from "@/lib/row-actions/invoice-row";

/**
 * #1038 / UX Phase 10 — unit coverage for the invoice row's overflow-menu
 * logic, so the state × permission matrix is testable without mounting the
 * Convex-wired ledger. `Issue` lives ONLY here (never as a row button); Record
 * payment and Push to Xero stay row links and are not in this menu.
 */
function handlers() {
  return {
    onIssue: vi.fn(),
    onCreditRequest: vi.fn(),
    onDeleteDraft: vi.fn(),
    onVoidRequest: vi.fn(),
    onDeleteVoidRequest: vi.fn(),
  };
}
const ALL = { canDelete: true, canVoid: true, canIssue: true, canCreate: true };
const keys = (a: { key: string }[]) => a.map((x) => x.key);

describe("invoiceRowMenuActions", () => {
  it("a DRAFT offers Issue first, then Delete draft (danger, last)", () => {
    const actions = invoiceRowMenuActions({ status: "DRAFT", kind: "FULL" }, ALL, handlers());
    expect(keys(actions)).toEqual(["issue", "delete-draft"]);
    expect(actions[1].danger).toBe(true);
    expect(actions[1].confirm).toMatchObject({ confirmLabel: "Delete draft" }); // a hard delete asks first
  });

  it("a DRAFT hides Issue without invoice:issue and Delete draft without invoice:delete", () => {
    expect(keys(invoiceRowMenuActions({ status: "DRAFT", kind: "FULL" }, { ...ALL, canIssue: false }, handlers()))).toEqual(["delete-draft"]);
    expect(keys(invoiceRowMenuActions({ status: "DRAFT", kind: "FULL" }, { ...ALL, canDelete: false }, handlers()))).toEqual(["issue"]);
    expect(invoiceRowMenuActions({ status: "DRAFT", kind: "FULL" }, { canDelete: false, canVoid: true, canIssue: false, canCreate: true }, handlers())).toEqual([]);
  });

  it("an ISSUED invoice offers Credit note then Void; Void is danger and last", () => {
    const actions = invoiceRowMenuActions({ status: "ISSUED", kind: "FULL" }, ALL, handlers());
    expect(keys(actions)).toEqual(["credit-note", "void"]);
    expect(actions[1].danger).toBe(true);
  });

  it("no Credit note on a credit note, without invoice:create, or when one already exists", () => {
    expect(keys(invoiceRowMenuActions({ status: "ISSUED", kind: "CREDIT" }, ALL, handlers()))).toEqual(["void"]);
    expect(keys(invoiceRowMenuActions({ status: "ISSUED", kind: "FULL" }, { ...ALL, canCreate: false }, handlers()))).toEqual(["void"]);
    expect(keys(invoiceRowMenuActions({ status: "ISSUED", kind: "FULL" }, ALL, handlers(), true))).toEqual(["void"]);
  });

  it("Issue is never offered on an ISSUED or VOID invoice", () => {
    expect(keys(invoiceRowMenuActions({ status: "ISSUED", kind: "FULL" }, ALL, handlers()))).not.toContain("issue");
    expect(keys(invoiceRowMenuActions({ status: "VOID", kind: "FULL" }, ALL, handlers()))).not.toContain("issue");
  });

  it("a VOID invoice offers Delete permanently when permitted (#1055), nothing otherwise", () => {
    const actions = invoiceRowMenuActions({ status: "VOID", kind: "FULL" }, ALL, handlers());
    expect(keys(actions)).toEqual(["delete-void"]);
    expect(actions[0].danger).toBe(true);
    expect(invoiceRowMenuActions({ status: "VOID", kind: "FULL" }, { ...ALL, canDelete: false }, handlers())).toEqual([]);
  });
});
