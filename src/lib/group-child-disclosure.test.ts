/**
 * Unit tests for group child disclosure — the strict flag reading and the pure
 * selector that decides which members a client-facing document lists under a
 * group's collapsed row.
 */
import { describe, it, expect } from "vitest";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import {
  isGroupChildDisclosed,
  disclosedGroupChildren,
  canDiscloseGroupChild,
} from "./group-child-disclosure";

function member(over: Partial<DocumentLineItem> & { id: string }): DocumentLineItem {
  return {
    description: over.id,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: 100,
    pricingType: "FLAT",
    duration: 1,
    discount: null,
    lineTotal: 100,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...over,
  } as DocumentLineItem;
}

describe("isGroupChildDisclosed", () => {
  it("is true only for an exact boolean true", () => {
    expect(isGroupChildDisclosed(true)).toBe(true);
  });

  // This decides what a CLIENT sees, so anything ambiguous fails closed.
  it("fails closed on anything else", () => {
    for (const value of [false, undefined, null, "true", 1, {}, []]) {
      expect(isGroupChildDisclosed(value)).toBe(false);
    }
  });
});

describe("disclosedGroupChildren", () => {
  it("returns undefined when nothing is disclosed — the pre-feature row shape", () => {
    expect(disclosedGroupChildren([])).toBeUndefined();
    expect(disclosedGroupChildren([member({ id: "a" }), member({ id: "b" })])).toBeUndefined();
  });

  it("returns only the disclosed members, in order", () => {
    const result = disclosedGroupChildren([
      member({ id: "a" }),
      member({ id: "b", showInGroupOnDocs: true }),
      member({ id: "c" }),
      member({ id: "d", showInGroupOnDocs: true }),
    ]);
    expect(result?.map((m) => m.id)).toEqual(["b", "d"]);
  });

  // The member's own price is an internal build-up figure the group's bundle
  // price supersedes — printing both would put two numbers for the same gear
  // on one document.
  it("stamps every disclosed member priceHidden, whatever its own price", () => {
    const result = disclosedGroupChildren([
      member({ id: "b", showInGroupOnDocs: true, unitPrice: 250, lineTotal: 500 }),
    ]);
    expect(result?.[0]).toMatchObject({ priceHidden: true });
    // The underlying figures are untouched — only the rendering decision changes.
    expect(result?.[0].lineTotal).toBe(500);
  });

  it("does not mutate the input rows", () => {
    const rows = [member({ id: "b", showInGroupOnDocs: true })];
    disclosedGroupChildren(rows);
    expect(rows[0].priceHidden).toBeUndefined();
  });

  // A kit inside a group is itself a collapsing container; exploding one here
  // would disclose a second level of contents nobody asked for.
  it("excludes a disclosed KIT PARENT", () => {
    const result = disclosedGroupChildren([
      member({ id: "kit", showInGroupOnDocs: true, kitId: "k1", isKitChild: false }),
      member({ id: "plain", showInGroupOnDocs: true }),
    ]);
    expect(result?.map((m) => m.id)).toEqual(["plain"]);
  });

  it("returns undefined when the only disclosed member is a kit parent", () => {
    expect(
      disclosedGroupChildren([member({ id: "kit", showInGroupOnDocs: true, kitId: "k1", isKitChild: false })]),
    ).toBeUndefined();
  });
});

// The same rule `disclosedGroupChildren` filters by, exported so the equipment
// tab can decide whether to OFFER the toggle. A toggle the renderer ignores is
// worse than no toggle.
describe("canDiscloseGroupChild", () => {
  it("allows a plain member", () => {
    expect(canDiscloseGroupChild({})).toBe(true);
    expect(canDiscloseGroupChild({ kitId: null, isKitChild: false })).toBe(true);
  });

  it("refuses a kit parent", () => {
    expect(canDiscloseGroupChild({ kitId: "k1", isKitChild: false })).toBe(false);
  });

  it("allows a kit's own child (it is never asked about at the group level)", () => {
    expect(canDiscloseGroupChild({ kitId: "k1", isKitChild: true })).toBe(true);
  });

  it("agrees with what disclosedGroupChildren actually renders", () => {
    const rows = [
      member({ id: "kit", showInGroupOnDocs: true, kitId: "k1", isKitChild: false }),
      member({ id: "plain", showInGroupOnDocs: true }),
    ];
    const rendered = disclosedGroupChildren(rows)?.map((m) => m.id) ?? [];
    expect(rows.filter(canDiscloseGroupChild).map((m) => m.id)).toEqual(rendered);
  });
});
