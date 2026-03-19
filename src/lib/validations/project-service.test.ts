import { describe, it, expect } from "vitest";
import { projectServiceSchema, serviceTemplateSchema } from "./project-service";

// ---------------------------------------------------------------------------
// projectServiceSchema
// ---------------------------------------------------------------------------
describe("projectServiceSchema", () => {
  const minimal = { type: "DELIVERY" as const, title: "Delivery to venue" };

  const complete = {
    type: "BUMP_IN" as const,
    title: "Bump In - Main Stage",
    description: "Full stage setup including lighting rigs",
    notes: "Access via loading dock B",
    date: "2024-06-15",
    endDate: "2024-06-16",
    startTime: "06:00",
    endTime: "22:00",
    scheduledTime: "07:00",
    estimatedDuration: 8,
    address: "123 Venue St, Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
    showOnDocuments: true,
    unitPrice: 250,
    quantity: 2,
    pricingType: "FLAT" as const,
    duration: 8,
    discount: 10,
    taxable: false,
    vehicleDescription: "3-tonne truck",
    numberOfTrips: 2,
    crewCountRequired: 4,
    crewRoleId: "role-1",
    crewMemberIds: ["cm-1", "cm-2"],
  };

  it("accepts valid minimal data", () => {
    const result = projectServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("DELIVERY");
      expect(result.data.title).toBe("Delivery to venue");
    }
  });

  it("accepts valid complete data", () => {
    const result = projectServiceSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
      expect(result.data.latitude).toBe(-33.8688);
      expect(result.data.quantity).toBe(2);
      expect(result.data.crewMemberIds).toEqual(["cm-1", "cm-2"]);
    }
  });

  // Defaults
  it("applies default values", () => {
    const result = projectServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.showOnDocuments).toBe(false);
      expect(result.data.quantity).toBe(1);
      expect(result.data.taxable).toBe(true);
    }
  });

  // Required fields
  it("rejects missing type", () => {
    const result = projectServiceSchema.safeParse({ title: "Some service" });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = projectServiceSchema.safeParse({ type: "DELIVERY" });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = projectServiceSchema.safeParse({ type: "DELIVERY", title: "" });
    expect(result.success).toBe(false);
  });

  // Enum validation
  it("rejects invalid type enum", () => {
    const result = projectServiceSchema.safeParse({ type: "BREAKDOWN", title: "Test" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    for (const t of ["DELIVERY", "PICKUP", "BUMP_IN", "BUMP_OUT", "LABOUR", "MISC"] as const) {
      const result = projectServiceSchema.safeParse({ type: t, title: "Test" });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid pricingType enum", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, pricingType: "MONTHLY" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for pricingType", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, pricingType: "" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid pricingType values", () => {
    for (const pt of ["PER_DAY", "PER_HOUR", "FLAT"] as const) {
      const result = projectServiceSchema.safeParse({ ...minimal, pricingType: pt });
      expect(result.success).toBe(true);
    }
  });

  // Date transforms
  it("transforms empty string date to undefined", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, date: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeUndefined();
    }
  });

  it("transforms empty string endDate to undefined", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, endDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endDate).toBeUndefined();
    }
  });

  it("coerces valid date string to Date", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, date: "2024-12-25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
    }
  });

  // Number coercion
  it("coerces string to number for estimatedDuration", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, estimatedDuration: "4.5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedDuration).toBe(4.5);
    }
  });

  it("coerces string to number for unitPrice", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, unitPrice: "100" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitPrice).toBe(100);
    }
  });

  it("coerces string to number for quantity", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, quantity: "3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(3);
    }
  });

  it("rejects quantity less than 1", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, quantity: -1 });
    expect(result.success).toBe(false);
  });

  // Lat/lng
  it("accepts null for latitude", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, latitude: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBeNull();
    }
  });

  it("accepts null for longitude", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, longitude: null });
    expect(result.success).toBe(true);
  });

  it("coerces string to number for latitude", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, latitude: "-33.86" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(-33.86);
    }
  });

  // crewMemberIds array
  it("accepts empty crewMemberIds array", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, crewMemberIds: [] });
    expect(result.success).toBe(true);
  });

  it("accepts undefined crewMemberIds", () => {
    const result = projectServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crewMemberIds).toBeUndefined();
    }
  });

  // Optional string fields
  it("accepts undefined for optional string fields", () => {
    const result = projectServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
      expect(result.data.address).toBeUndefined();
      expect(result.data.vehicleDescription).toBeUndefined();
    }
  });

  // Edge: quantity boundary
  it("accepts quantity of exactly 1", () => {
    const result = projectServiceSchema.safeParse({ ...minimal, quantity: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// serviceTemplateSchema
// ---------------------------------------------------------------------------
describe("serviceTemplateSchema", () => {
  const minimal = { type: "LABOUR" as const, title: "Stagehand Labour" };

  const complete = {
    type: "DELIVERY" as const,
    title: "Standard Delivery",
    description: "Standard equipment delivery service",
    defaultCrewCount: 2,
    defaultVehicle: "3-tonne truck",
    defaultPricingType: "PER_DAY" as const,
    defaultUnitPrice: 350,
    showOnDocuments: true,
    isAutoAdded: true,
    isActive: false,
  };

  it("accepts valid minimal data", () => {
    const result = serviceTemplateSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = serviceTemplateSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultCrewCount).toBe(2);
      expect(result.data.defaultVehicle).toBe("3-tonne truck");
      expect(result.data.defaultPricingType).toBe("PER_DAY");
      expect(result.data.isAutoAdded).toBe(true);
      expect(result.data.isActive).toBe(false);
    }
  });

  // Defaults
  it("applies default values", () => {
    const result = serviceTemplateSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.showOnDocuments).toBe(false);
      expect(result.data.isAutoAdded).toBe(false);
      expect(result.data.isActive).toBe(true);
    }
  });

  // Required fields
  it("rejects missing type", () => {
    const result = serviceTemplateSchema.safeParse({ title: "Test" });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = serviceTemplateSchema.safeParse({ type: "LABOUR" });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = serviceTemplateSchema.safeParse({ type: "LABOUR", title: "" });
    expect(result.success).toBe(false);
  });

  // Enum validation
  it("rejects invalid type enum", () => {
    const result = serviceTemplateSchema.safeParse({ type: "BREAKDOWN", title: "Test" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    for (const t of ["DELIVERY", "PICKUP", "BUMP_IN", "BUMP_OUT", "LABOUR", "MISC"] as const) {
      const result = serviceTemplateSchema.safeParse({ type: t, title: "Test" });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid defaultPricingType", () => {
    const result = serviceTemplateSchema.safeParse({ ...minimal, defaultPricingType: "MONTHLY" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for defaultPricingType", () => {
    const result = serviceTemplateSchema.safeParse({ ...minimal, defaultPricingType: "" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid defaultPricingType values", () => {
    for (const pt of ["PER_DAY", "PER_HOUR", "FLAT"] as const) {
      const result = serviceTemplateSchema.safeParse({ ...minimal, defaultPricingType: pt });
      expect(result.success).toBe(true);
    }
  });

  // Number coercion
  it("coerces string to number for defaultCrewCount", () => {
    const result = serviceTemplateSchema.safeParse({ ...minimal, defaultCrewCount: "3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultCrewCount).toBe(3);
    }
  });

  it("coerces string to number for defaultUnitPrice", () => {
    const result = serviceTemplateSchema.safeParse({ ...minimal, defaultUnitPrice: "199.99" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultUnitPrice).toBe(199.99);
    }
  });
});
