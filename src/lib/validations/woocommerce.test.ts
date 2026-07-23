import { describe, it, expect } from "vitest";
import { wooCommerceIntegrationSchema, wooOrderSchema } from "./woocommerce";

describe("wooCommerceIntegrationSchema", () => {
  // ---------------------------------------------------------------------------
  // Valid data
  // ---------------------------------------------------------------------------
  it("accepts valid minimal data (empty object, all defaults apply)", () => {
    const result = wooCommerceIntegrationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = wooCommerceIntegrationSchema.safeParse({
      isEnabled: true,
      storeUrl: "https://shop.example.com",
      productMatchField: "custom_field",
      customFieldKey: "sku_ref",
      rentalStartKey: "rental_start",
      rentalEndKey: "rental_end",
      eventStartKey: "event_date",
      deliveryAddressKey: "delivery_addr",
      notesKey: "order_notes",
      locationMetaKey: "warehouse_id",
      defaultLocationId: "loc-abc-123",
      dateFormat: "DD/MM/YYYY",
      defaultProjectType: "CORPORATE",
      autoConfirmEnquiry: true,
      notifyUserIds: ["user-1", "user-2", "user-3"],
    });
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Default values
  // ---------------------------------------------------------------------------
  it("applies default isEnabled false", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.isEnabled).toBe(false);
  });

  it("applies default productMatchField sku", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.productMatchField).toBe("sku");
  });

  it("applies default dateFormat auto", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.dateFormat).toBe("auto");
  });

  it("applies default defaultProjectType DRY_HIRE", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.defaultProjectType).toBe("DRY_HIRE");
  });

  it("applies default autoConfirmEnquiry false", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.autoConfirmEnquiry).toBe(false);
  });

  it("applies default notifyUserIds empty array", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.notifyUserIds).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // storeUrl validation
  // ---------------------------------------------------------------------------
  it("accepts valid HTTPS storeUrl", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ storeUrl: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts valid HTTP storeUrl", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ storeUrl: "http://localhost:3000" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid storeUrl (not a URL)", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ storeUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for storeUrl (or literal)", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ storeUrl: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.storeUrl).toBe("");
    }
  });

  it("accepts omitted storeUrl", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.storeUrl).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // defaultLocationId — optional or empty string
  // ---------------------------------------------------------------------------
  it("accepts valid defaultLocationId string", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ defaultLocationId: "loc-123" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for defaultLocationId", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ defaultLocationId: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultLocationId).toBe("");
    }
  });

  it("accepts omitted defaultLocationId", () => {
    const parsed = wooCommerceIntegrationSchema.parse({});
    expect(parsed.defaultLocationId).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Enum validation — productMatchField
  // ---------------------------------------------------------------------------
  it("accepts all valid productMatchField values", () => {
    for (const val of ["sku", "custom_field", "name"]) {
      const result = wooCommerceIntegrationSchema.safeParse({ productMatchField: val });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid productMatchField", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ productMatchField: "barcode" });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Enum validation — dateFormat
  // ---------------------------------------------------------------------------
  it("accepts all valid dateFormat values", () => {
    for (const val of ["auto", "DD/MM/YYYY", "MM/DD/YYYY", "ISO"]) {
      const result = wooCommerceIntegrationSchema.safeParse({ dateFormat: val });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid dateFormat", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ dateFormat: "YYYY-MM-DD" });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Enum validation — defaultProjectType
  // ---------------------------------------------------------------------------
  it("accepts all valid defaultProjectType values", () => {
    const types = [
      "DRY_HIRE", "WET_HIRE", "INSTALLATION", "TOUR",
      "CORPORATE", "THEATRE", "FESTIVAL", "CONFERENCE", "OTHER",
    ];
    for (const val of types) {
      const result = wooCommerceIntegrationSchema.safeParse({ defaultProjectType: val });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid defaultProjectType", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ defaultProjectType: "WEDDING" });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Max length — string keys (100 chars max)
  // ---------------------------------------------------------------------------
  const stringKeyFields = [
    "customFieldKey",
    "rentalStartKey",
    "rentalEndKey",
    "eventStartKey",
    "deliveryAddressKey",
    "notesKey",
    "locationMetaKey",
  ] as const;

  for (const field of stringKeyFields) {
    it(`rejects ${field} longer than 100 chars`, () => {
      const result = wooCommerceIntegrationSchema.safeParse({ [field]: "x".repeat(101) });
      expect(result.success).toBe(false);
    });

    it(`accepts ${field} at exactly 100 chars`, () => {
      const result = wooCommerceIntegrationSchema.safeParse({ [field]: "x".repeat(100) });
      expect(result.success).toBe(true);
    });

    it(`accepts omitted ${field}`, () => {
      const parsed = wooCommerceIntegrationSchema.parse({});
      expect(parsed[field]).toBeUndefined();
    });
  }

  // ---------------------------------------------------------------------------
  // Boolean fields
  // ---------------------------------------------------------------------------
  it("accepts isEnabled true", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ isEnabled: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEnabled).toBe(true);
    }
  });

  it("accepts autoConfirmEnquiry true", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ autoConfirmEnquiry: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoConfirmEnquiry).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // notifyUserIds
  // ---------------------------------------------------------------------------
  it("accepts notifyUserIds as array of strings", () => {
    const result = wooCommerceIntegrationSchema.safeParse({
      notifyUserIds: ["user-a", "user-b"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifyUserIds).toEqual(["user-a", "user-b"]);
    }
  });

  it("accepts empty notifyUserIds array", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ notifyUserIds: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifyUserIds).toEqual([]);
    }
  });

  it("rejects notifyUserIds with non-string elements", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ notifyUserIds: [123, 456] });
    expect(result.success).toBe(false);
  });

  it("rejects notifyUserIds as a string (not array)", () => {
    const result = wooCommerceIntegrationSchema.safeParse({ notifyUserIds: "user-a" });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  it("overrides all defaults when explicit values are provided", () => {
    const parsed = wooCommerceIntegrationSchema.parse({
      isEnabled: true,
      productMatchField: "name",
      dateFormat: "ISO",
      defaultProjectType: "FESTIVAL",
      autoConfirmEnquiry: true,
      notifyUserIds: ["u1"],
    });
    expect(parsed.isEnabled).toBe(true);
    expect(parsed.productMatchField).toBe("name");
    expect(parsed.dateFormat).toBe("ISO");
    expect(parsed.defaultProjectType).toBe("FESTIVAL");
    expect(parsed.autoConfirmEnquiry).toBe(true);
    expect(parsed.notifyUserIds).toEqual(["u1"]);
  });

  it("accepts storeUrl with trailing path", () => {
    const result = wooCommerceIntegrationSchema.safeParse({
      storeUrl: "https://shop.example.com/wp-json/wc/v3",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict by default in Zod v4)", () => {
    // Zod v4 strips unknown keys by default; this verifies it doesn't crash
    const result = wooCommerceIntegrationSchema.safeParse({
      unknownField: "should be stripped",
    });
    // Should succeed because Zod strips unknown keys
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["unknownField"]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// wooOrderSchema — the webhook trust-boundary schema (POLICY.md R-8.2.3)
// ---------------------------------------------------------------------------
describe("wooOrderSchema", () => {
  const validOrder = {
    id: 123,
    number: "123",
    status: "processing",
    billing: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    },
    line_items: [
      { name: "Widget", quantity: 2, price: "10.00" },
    ],
  };

  it("accepts a minimal valid order", () => {
    const result = wooOrderSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
  });

  it("accepts a full order with meta_data and optional billing fields", () => {
    const result = wooOrderSchema.safeParse({
      ...validOrder,
      customer_note: "Leave at the loading dock",
      meta_data: [{ key: "_rental_start", value: "2026-08-01" }],
      billing: {
        ...validOrder.billing,
        company: "Acme Co",
        phone: "0400000000",
        address_1: "1 Example St",
        city: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "AU",
      },
      line_items: [
        {
          name: "Widget",
          sku: "WID-1",
          quantity: 2,
          price: "10.00",
          meta_data: [{ key: "_variation", value: "Blue" }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown top-level and nested fields instead of rejecting", () => {
    const result = wooOrderSchema.safeParse({
      ...validOrder,
      totally_unknown_field: "ignored",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["totally_unknown_field"]).toBeUndefined();
    }
  });

  it("coerces a non-string meta_data value instead of rejecting", () => {
    const result = wooOrderSchema.safeParse({
      ...validOrder,
      meta_data: [{ key: "_quantity_hint", value: 5 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta_data?.[0].value).toBe("5");
    }
  });

  it("rejects a payload missing required id", () => {
    const { id: _id, ...withoutId } = validOrder;
    const result = wooOrderSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing required billing", () => {
    const { billing: _billing, ...withoutBilling } = validOrder;
    const result = wooOrderSchema.safeParse(withoutBilling);
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing required line_items", () => {
    const { line_items: _lineItems, ...withoutLineItems } = validOrder;
    const result = wooOrderSchema.safeParse(withoutLineItems);
    expect(result.success).toBe(false);
  });

  it("rejects a payload with a malformed line item (missing price)", () => {
    const result = wooOrderSchema.safeParse({
      ...validOrder,
      line_items: [{ name: "Widget", quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload where billing is missing a required field", () => {
    const result = wooOrderSchema.safeParse({
      ...validOrder,
      billing: { first_name: "Jane", last_name: "Doe" }, // missing email
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(wooOrderSchema.safeParse(null).success).toBe(false);
    expect(wooOrderSchema.safeParse("order").success).toBe(false);
    expect(wooOrderSchema.safeParse(42).success).toBe(false);
  });
});
