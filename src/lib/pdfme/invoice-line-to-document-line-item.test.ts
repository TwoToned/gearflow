// @vitest-environment node
//
// invoiceLineToDocumentLineItem (bug fix) — the mapping a DEPOSIT/BALANCE/
// CREDIT invoice's own stored summary line goes through to become the ONE
// row a PDF render shows for it, instead of the live project's full
// equipment/service breakdown. Kept as a pure, isolated function so this
// mapping is testable without pulling in build-document-data.ts's Prisma/
// Convex/storage dependencies.
import { describe, test, expect } from "vitest";
import { invoiceLineToDocumentLineItem } from "./build-document-data";

describe("invoiceLineToDocumentLineItem", () => {
  test("maps a stored deposit summary line to the invoice amount, not any live pricing", () => {
    const result = invoiceLineToDocumentLineItem({
      id: "il1",
      description: "Deposit (25% of project total)",
      quantity: 1,
      unitPrice: 275,
      lineTotal: 275,
    });

    expect(result.description).toBe("Deposit (25% of project total)");
    expect(result.unitPrice).toBe(275);
    expect(result.lineTotal).toBe(275);
    expect(result.quantity).toBe(1);
  });

  test("carries no groupName/categoryName — renders as a bare row with no section header", () => {
    const result = invoiceLineToDocumentLineItem({
      id: "il2",
      description: "Balance due",
      quantity: 1,
      unitPrice: 825,
      lineTotal: 825,
    });

    expect(result.groupName).toBeNull();
    expect(result.categoryName).toBeNull();
    expect(result.groupTitle).toBeNull();
  });

  test("is never mistaken for equipment/kit content that other PDF consumers special-case", () => {
    const result = invoiceLineToDocumentLineItem({
      id: "il3",
      description: "Credit for invoice INV-2026-0004",
      quantity: 1,
      unitPrice: -110,
      lineTotal: -110,
    });

    expect(result.isKitChild).toBeUndefined();
    expect(result.kitId).toBeUndefined();
    expect(result.model).toBeNull();
    expect(result.asset).toBeNull();
    expect(result.bulkAsset).toBeNull();
    expect(result.isGroupRow).toBe(false);
    expect(result.type).toBeUndefined();
  });

  test("id is namespaced so it can never collide with a real project line item's id", () => {
    const result = invoiceLineToDocumentLineItem({
      id: "shared-id",
      description: "Deposit",
      quantity: 1,
      unitPrice: 100,
      lineTotal: 100,
    });

    expect(result.id).toBe("invline-shared-id");
  });
});
