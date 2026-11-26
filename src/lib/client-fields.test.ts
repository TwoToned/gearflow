import { describe, expect, it } from "vitest";
import { clearedClientFields, toClientFields } from "./client-fields";
import { clientSchema } from "./validations/client";
import { CLIENT_CLEARABLE_FIELDS } from "../../convex/lib/peopleEditFields";

// A blank form field must CLEAR the stored value on an edit (an absent patch key keeps it): the hook sends the blank
// optional fields as `clear`, and optional money stays blank (never an explicit 0).
const parse = (over: Record<string, unknown>) => clientSchema.parse({ name: "Hilton", ...over });

describe("clearedClientFields", () => {
  it("lists every optional field the form left blank", () => {
    expect(clearedClientFields(toClientFields(parse({})))).toEqual([...CLIENT_CLEARABLE_FIELDS]);
  });

  it("does not list a field that has a value", () => {
    const cleared = clearedClientFields(toClientFields(parse({ notes: "n", taxId: "ABN", defaultDiscount: "10", billingLatitude: 1, billingLongitude: 2 })));
    expect(cleared).not.toContain("notes");
    expect(cleared).not.toContain("taxId");
    expect(cleared).not.toContain("defaultDiscount");
    expect(cleared).not.toContain("billingLatitude");
    expect(cleared).toContain("shippingAddress");
  });

  it("a blank address (the form sends '') and a null coordinate both clear", () => {
    const cleared = clearedClientFields(toClientFields(parse({ billingAddress: "", billingLatitude: null, billingLongitude: null })));
    expect(cleared).toEqual(expect.arrayContaining(["billingAddress", "billingLatitude", "billingLongitude"]));
  });
});

describe("optional money is blankable on a client", () => {
  it("a blank discount / deposit percent is blank (cleared), never an explicit 0", () => {
    const f = toClientFields(parse({ defaultDiscount: "", profileDepositPercent: "" }));
    expect(f.defaultDiscount).toBeUndefined();
    expect(f.profileDepositPercent).toBeUndefined();
    expect(clearedClientFields(f)).toEqual(expect.arrayContaining(["defaultDiscount", "profileDepositPercent"]));
  });

  it("a typed 0 stays 0 (a deliberate no-discount is a real value), and the bounds hold", () => {
    expect(toClientFields(parse({ defaultDiscount: "0" })).defaultDiscount).toBe(0);
    expect(clientSchema.safeParse({ name: "x", defaultDiscount: "101" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "x", profileDepositPercent: "-1" }).success).toBe(false);
  });
});
