import { describe, it, expect } from "vitest";
import { projectSchema } from "./project";

const validMinimal = { name: "Summer Festival 2024" };

const validComplete = {
  projectNumber: "PRJ-001",
  name: "Corporate AV Install",
  clientId: "client-123",
  status: "CONFIRMED" as const,
  type: "CORPORATE" as const,
  description: "Full AV installation for conference center",
  locationId: "loc-456",
  siteContactName: "Jane Smith",
  siteContactPhone: "+61 400 123 456",
  siteContactEmail: "jane@example.com",
  loadInDate: new Date("2024-07-10"),
  loadInTime: "08:00",
  eventStartDate: new Date("2024-07-11"),
  eventStartTime: "09:00",
  eventEndDate: new Date("2024-07-13"),
  eventEndTime: "17:00",
  loadOutDate: new Date("2024-07-14"),
  loadOutTime: "06:00",
  rentalStartDate: new Date("2024-07-10"),
  rentalEndDate: new Date("2024-07-14"),
  crewNotes: "Crew call at 7am sharp",
  internalNotes: "Client budget is flexible",
  clientNotes: "Parking available at rear",
  discountPercent: 10,
  depositPercent: 50,
  depositPaid: 5000,
  invoicedTotal: 10000,
  tags: ["corporate", "AV", "install"],
};

describe("projectSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = projectSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("name (required, max 200)", () => {
    it("rejects missing name", () => {
      const result = projectSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string name", () => {
      const result = projectSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts name at max length (200)", () => {
      const result = projectSchema.safeParse({ name: "a".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects name exceeding max length", () => {
      const result = projectSchema.safeParse({ name: "a".repeat(201) });
      expect(result.success).toBe(false);
    });

    it("accepts name with 1 character", () => {
      const result = projectSchema.safeParse({ name: "X" });
      expect(result.success).toBe(true);
    });
  });

  describe("projectNumber (optional, max 50, defaults to empty string)", () => {
    it("defaults to empty string", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.projectNumber).toBe("");
    });

    it("accepts at max length (50)", () => {
      const result = projectSchema.safeParse({ ...validMinimal, projectNumber: "p".repeat(50) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, projectNumber: "p".repeat(51) });
      expect(result.success).toBe(false);
    });
  });

  describe("status enum", () => {
    it("rejects invalid status", () => {
      const result = projectSchema.safeParse({ ...validMinimal, status: "PENDING" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid status values", () => {
      const statuses = [
        "ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING",
        "CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED", "CANCELLED",
      ];
      for (const val of statuses) {
        const result = projectSchema.safeParse({ ...validMinimal, status: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("type enum", () => {
    it("rejects invalid type", () => {
      const result = projectSchema.safeParse({ ...validMinimal, type: "WEDDING" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid type values", () => {
      const types = [
        "DRY_HIRE", "WET_HIRE", "INSTALLATION", "TOUR", "CORPORATE",
        "THEATRE", "FESTIVAL", "CONFERENCE", "OTHER",
      ];
      for (const val of types) {
        const result = projectSchema.safeParse({ ...validMinimal, type: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("default values", () => {
    it("defaults status to ENQUIRY", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("ENQUIRY");
    });

    it("defaults type to OTHER", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("OTHER");
    });

    it("defaults tags to empty array", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual([]);
    });

    it("defaults projectNumber to empty string", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.projectNumber).toBe("");
    });
  });

  describe("description (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, description: "d".repeat(2000) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, description: "d".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("siteContactName (optional, max 200)", () => {
    it("accepts at max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactName: "n".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactName: "n".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("siteContactPhone (optional, max 50)", () => {
    it("accepts at max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactPhone: "1".repeat(50) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactPhone: "1".repeat(51) });
      expect(result.success).toBe(false);
    });
  });

  describe("siteContactEmail (optional, email validation, or empty string)", () => {
    it("accepts valid email", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactEmail: "test@example.com" });
      expect(result.success).toBe(true);
    });

    it("accepts empty string (cleared field)", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactEmail: "" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email format", () => {
      const result = projectSchema.safeParse({ ...validMinimal, siteContactEmail: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects email exceeding max length (200)", () => {
      const longEmail = "a".repeat(192) + "@test.com"; // 201 chars total
      const result = projectSchema.safeParse({ ...validMinimal, siteContactEmail: longEmail });
      expect(result.success).toBe(false);
    });

    it("accepts undefined", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });
  });

  describe("date transforms (empty string → undefined)", () => {
    const dateFields = [
      "loadInDate", "eventStartDate", "eventEndDate", "loadOutDate",
      "rentalStartDate", "rentalEndDate",
    ] as const;

    for (const field of dateFields) {
      it(`transforms empty string ${field} to undefined`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeUndefined();
      });

      it(`accepts valid date for ${field}`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: new Date("2024-07-01") });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeInstanceOf(Date);
      });

      it(`coerces date string for ${field}`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "2024-07-01" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeInstanceOf(Date);
      });

      it(`accepts undefined for ${field}`, () => {
        const result = projectSchema.safeParse(validMinimal);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeUndefined();
      });
    }
  });

  describe("time transforms (empty string → undefined)", () => {
    const timeFields = [
      "loadInTime", "eventStartTime", "eventEndTime", "loadOutTime",
    ] as const;

    for (const field of timeFields) {
      it(`transforms empty string ${field} to undefined`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeUndefined();
      });

      it(`accepts valid time string for ${field}`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "14:30" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBe("14:30");
      });

      it(`accepts undefined for ${field}`, () => {
        const result = projectSchema.safeParse(validMinimal);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[field]).toBeUndefined();
      });
    }
  });

  describe("notes fields (optional, max 5000)", () => {
    for (const field of ["crewNotes", "internalNotes", "clientNotes"] as const) {
      it(`accepts ${field} at max length`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "n".repeat(5000) });
        expect(result.success).toBe(true);
      });

      it(`rejects ${field} exceeding max length`, () => {
        const result = projectSchema.safeParse({ ...validMinimal, [field]: "n".repeat(5001) });
        expect(result.success).toBe(false);
      });
    }
  });

  describe("numeric fields", () => {
    it("accepts discountPercent at boundary (0)", () => {
      const result = projectSchema.safeParse({ ...validMinimal, discountPercent: 0 });
      expect(result.success).toBe(true);
    });

    it("accepts discountPercent at boundary (100)", () => {
      const result = projectSchema.safeParse({ ...validMinimal, discountPercent: 100 });
      expect(result.success).toBe(true);
    });

    it("rejects discountPercent over 100", () => {
      const result = projectSchema.safeParse({ ...validMinimal, discountPercent: 101 });
      expect(result.success).toBe(false);
    });

    it("rejects negative discountPercent", () => {
      const result = projectSchema.safeParse({ ...validMinimal, discountPercent: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts depositPercent at boundaries (0 and 100)", () => {
      let result = projectSchema.safeParse({ ...validMinimal, depositPercent: 0 });
      expect(result.success).toBe(true);
      result = projectSchema.safeParse({ ...validMinimal, depositPercent: 100 });
      expect(result.success).toBe(true);
    });

    it("rejects depositPercent over 100", () => {
      const result = projectSchema.safeParse({ ...validMinimal, depositPercent: 101 });
      expect(result.success).toBe(false);
    });

    it("rejects negative depositPercent", () => {
      const result = projectSchema.safeParse({ ...validMinimal, depositPercent: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects negative depositPaid", () => {
      const result = projectSchema.safeParse({ ...validMinimal, depositPaid: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero depositPaid", () => {
      const result = projectSchema.safeParse({ ...validMinimal, depositPaid: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative invoicedTotal", () => {
      const result = projectSchema.safeParse({ ...validMinimal, invoicedTotal: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero invoicedTotal", () => {
      const result = projectSchema.safeParse({ ...validMinimal, invoicedTotal: 0 });
      expect(result.success).toBe(true);
    });

    it("coerces string percent values to numbers", () => {
      const result = projectSchema.safeParse({
        ...validMinimal,
        discountPercent: "15",
        depositPercent: "50",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountPercent).toBe(15);
        expect(result.data.depositPercent).toBe(50);
      }
    });

    it("coerces string money values to numbers", () => {
      const result = projectSchema.safeParse({
        ...validMinimal,
        depositPaid: "2500.50",
        invoicedTotal: "10000",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.depositPaid).toBe(2500.5);
        expect(result.data.invoicedTotal).toBe(10000);
      }
    });
  });

  describe("edge cases", () => {
    it("accepts all optional fields as undefined", () => {
      const result = projectSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clientId).toBeUndefined();
        expect(result.data.description).toBeUndefined();
        expect(result.data.locationId).toBeUndefined();
        expect(result.data.siteContactName).toBeUndefined();
        expect(result.data.siteContactPhone).toBeUndefined();
        expect(result.data.crewNotes).toBeUndefined();
        expect(result.data.internalNotes).toBeUndefined();
        expect(result.data.clientNotes).toBeUndefined();
        expect(result.data.discountPercent).toBeUndefined();
        expect(result.data.depositPercent).toBeUndefined();
        expect(result.data.depositPaid).toBeUndefined();
        expect(result.data.invoicedTotal).toBeUndefined();
      }
    });

    it("accepts decimal percent values", () => {
      const result = projectSchema.safeParse({
        ...validMinimal,
        discountPercent: 7.5,
        depositPercent: 33.33,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountPercent).toBe(7.5);
        expect(result.data.depositPercent).toBe(33.33);
      }
    });

    it("accepts tags with multiple entries", () => {
      const result = projectSchema.safeParse({
        ...validMinimal,
        tags: ["festival", "outdoor", "summer", "2024"],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual(["festival", "outdoor", "summer", "2024"]);
    });
  });
});
