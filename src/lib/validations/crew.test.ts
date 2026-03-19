import { describe, it, expect } from "vitest";
import {
  crewMemberSchema,
  crewRoleSchema,
  crewSkillSchema,
  crewCertificationSchema,
  crewAssignmentSchema,
  crewShiftSchema,
  crewAvailabilitySchema,
  crewTimeEntrySchema,
} from "./crew";

// ---------------------------------------------------------------------------
// crewMemberSchema
// ---------------------------------------------------------------------------
describe("crewMemberSchema", () => {
  const minimal = { firstName: "Jane", lastName: "Doe" };

  const complete = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "+61400000000",
    type: "EMPLOYEE" as const,
    status: "ON_LEAVE" as const,
    department: "Audio",
    crewRoleId: "role-1",
    defaultDayRate: 500,
    defaultHourlyRate: 65,
    overtimeMultiplier: 1.5,
    currency: "AUD",
    address: "123 Main St",
    addressLatitude: -33.8688,
    addressLongitude: 151.2093,
    emergencyContactName: "John Doe",
    emergencyContactPhone: "+61400111222",
    dateOfBirth: "1990-05-15",
    abnOrGst: "12345678901",
    notes: "Experienced audio engineer",
    tags: ["audio", "senior"],
    skillIds: ["skill-1", "skill-2"],
    userId: "user-1",
    isActive: false,
  };

  it("accepts valid minimal data", () => {
    const result = crewMemberSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("Jane");
      expect(result.data.lastName).toBe("Doe");
    }
  });

  it("accepts valid complete data", () => {
    const result = crewMemberSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("jane@example.com");
      expect(result.data.addressLatitude).toBe(-33.8688);
      expect(result.data.addressLongitude).toBe(151.2093);
      expect(result.data.dateOfBirth).toBeInstanceOf(Date);
    }
  });

  // Defaults
  it("applies default values", () => {
    const result = crewMemberSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("FREELANCER");
      expect(result.data.status).toBe("ACTIVE");
      expect(result.data.tags).toEqual([]);
      expect(result.data.skillIds).toEqual([]);
      expect(result.data.isActive).toBe(true);
    }
  });

  // Required fields
  it("rejects missing firstName", () => {
    const result = crewMemberSchema.safeParse({ lastName: "Doe" });
    expect(result.success).toBe(false);
  });

  it("rejects missing lastName", () => {
    const result = crewMemberSchema.safeParse({ firstName: "Jane" });
    expect(result.success).toBe(false);
  });

  it("rejects empty firstName", () => {
    const result = crewMemberSchema.safeParse({ firstName: "", lastName: "Doe" });
    expect(result.success).toBe(false);
  });

  it("rejects empty lastName", () => {
    const result = crewMemberSchema.safeParse({ firstName: "Jane", lastName: "" });
    expect(result.success).toBe(false);
  });

  // Max length enforcement
  it("rejects firstName exceeding 200 characters", () => {
    const result = crewMemberSchema.safeParse({ firstName: "a".repeat(201), lastName: "Doe" });
    expect(result.success).toBe(false);
  });

  it("rejects lastName exceeding 200 characters", () => {
    const result = crewMemberSchema.safeParse({ firstName: "Jane", lastName: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts firstName at exactly 200 characters", () => {
    const result = crewMemberSchema.safeParse({ firstName: "a".repeat(200), lastName: "Doe" });
    expect(result.success).toBe(true);
  });

  it("rejects email exceeding 200 characters", () => {
    const result = crewMemberSchema.safeParse({
      ...minimal,
      email: "a".repeat(190) + "@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects phone exceeding 50 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, phone: "1".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects department exceeding 100 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, department: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects currency exceeding 10 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, currency: "x".repeat(11) });
    expect(result.success).toBe(false);
  });

  it("rejects address exceeding 500 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, address: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects emergencyContactName exceeding 200 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, emergencyContactName: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects emergencyContactPhone exceeding 50 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, emergencyContactPhone: "1".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects abnOrGst exceeding 50 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, abnOrGst: "x".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // Enum validation
  it("rejects invalid type enum value", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, type: "INTERN" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum value", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, status: "FIRED" });
    expect(result.success).toBe(false);
  });

  // Email validation
  it("rejects invalid email format", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for email", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, email: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("");
    }
  });

  // Transform: empty string → undefined for rate fields
  it("transforms empty string defaultDayRate to undefined", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, defaultDayRate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultDayRate).toBeUndefined();
    }
  });

  it("transforms empty string defaultHourlyRate to undefined", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, defaultHourlyRate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultHourlyRate).toBeUndefined();
    }
  });

  it("transforms empty string overtimeMultiplier to undefined", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, overtimeMultiplier: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overtimeMultiplier).toBeUndefined();
    }
  });

  it("coerces string numbers to numbers for rate fields", () => {
    const result = crewMemberSchema.safeParse({
      ...minimal,
      defaultDayRate: "350",
      defaultHourlyRate: "45.50",
      overtimeMultiplier: "1.5",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultDayRate).toBe(350);
      expect(result.data.defaultHourlyRate).toBe(45.5);
      expect(result.data.overtimeMultiplier).toBe(1.5);
    }
  });

  it("rejects negative rate values", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, defaultDayRate: -10 });
    expect(result.success).toBe(false);
  });

  // Transform: dateOfBirth
  it("transforms empty string dateOfBirth to undefined", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, dateOfBirth: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateOfBirth).toBeUndefined();
    }
  });

  it("coerces valid date string for dateOfBirth", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, dateOfBirth: "2000-01-15" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateOfBirth).toBeInstanceOf(Date);
    }
  });

  // Refine: lat/lng must be together
  it("accepts both latitude and longitude present", () => {
    const result = crewMemberSchema.safeParse({
      ...minimal,
      addressLatitude: -33.86,
      addressLongitude: 151.20,
    });
    expect(result.success).toBe(true);
  });

  it("accepts both latitude and longitude absent", () => {
    const result = crewMemberSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects latitude without longitude", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, addressLatitude: -33.86 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("latitude and longitude must be provided together");
    }
  });

  it("rejects longitude without latitude", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, addressLongitude: 151.20 });
    expect(result.success).toBe(false);
  });

  it("accepts null latitude and null longitude (both absent)", () => {
    const result = crewMemberSchema.safeParse({
      ...minimal,
      addressLatitude: null,
      addressLongitude: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects null latitude with numeric longitude", () => {
    const result = crewMemberSchema.safeParse({
      ...minimal,
      addressLatitude: null,
      addressLongitude: 151.20,
    });
    expect(result.success).toBe(false);
  });

  // Optional string fields accept empty string via .or(z.literal(""))
  it("accepts empty string for crewRoleId", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, crewRoleId: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for userId", () => {
    const result = crewMemberSchema.safeParse({ ...minimal, userId: "" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// crewRoleSchema
// ---------------------------------------------------------------------------
describe("crewRoleSchema", () => {
  const minimal = { name: "Sound Engineer" };

  const complete = {
    name: "Sound Engineer",
    description: "Manages audio equipment",
    department: "Audio",
    color: "#FF5733",
    defaultRate: 450,
    rateType: "DAILY" as const,
    isActive: false,
  };

  it("accepts valid minimal data", () => {
    const result = crewRoleSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = crewRoleSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultRate).toBe(450);
      expect(result.data.rateType).toBe("DAILY");
    }
  });

  it("applies default isActive to true", () => {
    const result = crewRoleSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("rejects empty name", () => {
    const result = crewRoleSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = crewRoleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    const result = crewRoleSchema.safeParse({ name: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects description exceeding 500 characters", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, description: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects department exceeding 100 characters", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, department: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects color exceeding 20 characters", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, color: "a".repeat(21) });
    expect(result.success).toBe(false);
  });

  it("transforms empty string defaultRate to undefined", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, defaultRate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultRate).toBeUndefined();
    }
  });

  it("coerces string number for defaultRate", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, defaultRate: "250" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultRate).toBe(250);
    }
  });

  it("rejects negative defaultRate", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, defaultRate: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid rateType enum value", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, rateType: "MONTHLY" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for rateType", () => {
    const result = crewRoleSchema.safeParse({ ...minimal, rateType: "" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid rateType values", () => {
    for (const rt of ["HOURLY", "DAILY", "FLAT"] as const) {
      const result = crewRoleSchema.safeParse({ ...minimal, rateType: rt });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// crewSkillSchema
// ---------------------------------------------------------------------------
describe("crewSkillSchema", () => {
  it("accepts valid minimal data", () => {
    const result = crewSkillSchema.safeParse({ name: "Rigging" });
    expect(result.success).toBe(true);
  });

  it("accepts valid data with category", () => {
    const result = crewSkillSchema.safeParse({ name: "Rigging", category: "Staging" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("Staging");
    }
  });

  it("rejects empty name", () => {
    const result = crewSkillSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = crewSkillSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    const result = crewSkillSchema.safeParse({ name: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts name at exactly 200 characters", () => {
    const result = crewSkillSchema.safeParse({ name: "x".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("rejects category exceeding 100 characters", () => {
    const result = crewSkillSchema.safeParse({ name: "Rigging", category: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts category at exactly 100 characters", () => {
    const result = crewSkillSchema.safeParse({ name: "Rigging", category: "x".repeat(100) });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// crewCertificationSchema
// ---------------------------------------------------------------------------
describe("crewCertificationSchema", () => {
  const minimal = { name: "Working at Heights" };

  it("accepts valid minimal data", () => {
    const result = crewCertificationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = crewCertificationSchema.safeParse({
      name: "Working at Heights",
      issuedBy: "SafeWork NSW",
      certificateNumber: "CERT-12345",
      issuedDate: "2023-01-15",
      expiryDate: "2025-01-15",
      status: "CURRENT",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issuedDate).toBeInstanceOf(Date);
      expect(result.data.expiryDate).toBeInstanceOf(Date);
      expect(result.data.status).toBe("CURRENT");
    }
  });

  it("applies default status NOT_VERIFIED", () => {
    const result = crewCertificationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("NOT_VERIFIED");
    }
  });

  it("rejects empty name", () => {
    const result = crewCertificationSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    const result = crewCertificationSchema.safeParse({ name: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects issuedBy exceeding 200 characters", () => {
    const result = crewCertificationSchema.safeParse({ ...minimal, issuedBy: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects certificateNumber exceeding 100 characters", () => {
    const result = crewCertificationSchema.safeParse({ ...minimal, certificateNumber: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("transforms empty string issuedDate to undefined", () => {
    const result = crewCertificationSchema.safeParse({ ...minimal, issuedDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issuedDate).toBeUndefined();
    }
  });

  it("transforms empty string expiryDate to undefined", () => {
    const result = crewCertificationSchema.safeParse({ ...minimal, expiryDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiryDate).toBeUndefined();
    }
  });

  it("rejects invalid status enum value", () => {
    const result = crewCertificationSchema.safeParse({ ...minimal, status: "PENDING" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    for (const s of ["CURRENT", "EXPIRING_SOON", "EXPIRED", "NOT_VERIFIED"] as const) {
      const result = crewCertificationSchema.safeParse({ ...minimal, status: s });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// crewAssignmentSchema
// ---------------------------------------------------------------------------
describe("crewAssignmentSchema", () => {
  const minimal = { crewMemberId: "cm-1" };

  const complete = {
    crewMemberId: "cm-1",
    crewRoleId: "role-1",
    status: "CONFIRMED" as const,
    phase: "BUMP_IN" as const,
    isProjectManager: true,
    startDate: "2024-06-01",
    startTime: "08:00",
    endDate: "2024-06-03",
    endTime: "18:00",
    rateOverride: 500,
    rateType: "DAILY" as const,
    estimatedHours: 24,
    notes: "Lead technician",
    internalNotes: "Confirmed via phone",
    generateShifts: true,
    serviceId: "svc-1",
  };

  it("accepts valid minimal data", () => {
    const result = crewAssignmentSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = crewAssignmentSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
      expect(result.data.rateOverride).toBe(500);
      expect(result.data.estimatedHours).toBe(24);
    }
  });

  it("applies default values", () => {
    const result = crewAssignmentSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("PENDING");
      expect(result.data.isProjectManager).toBe(false);
      expect(result.data.generateShifts).toBe(false);
    }
  });

  it("rejects missing crewMemberId", () => {
    const result = crewAssignmentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty crewMemberId", () => {
    const result = crewAssignmentSchema.safeParse({ crewMemberId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, status: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    for (const s of ["PENDING", "OFFERED", "ACCEPTED", "DECLINED", "CONFIRMED", "CANCELLED", "COMPLETED"] as const) {
      const result = crewAssignmentSchema.safeParse({ ...minimal, status: s });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid phase enum", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, phase: "PARTY" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for phase", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, phase: "" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid phase values", () => {
    for (const p of ["BUMP_IN", "EVENT", "BUMP_OUT", "DELIVERY", "PICKUP", "SETUP", "REHEARSAL", "FULL_DURATION"] as const) {
      const result = crewAssignmentSchema.safeParse({ ...minimal, phase: p });
      expect(result.success).toBe(true);
    }
  });

  it("transforms empty string startDate to undefined", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, startDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeUndefined();
    }
  });

  it("transforms empty string endDate to undefined", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, endDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endDate).toBeUndefined();
    }
  });

  it("transforms empty string rateOverride to undefined", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, rateOverride: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateOverride).toBeUndefined();
    }
  });

  it("transforms empty string estimatedHours to undefined", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, estimatedHours: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedHours).toBeUndefined();
    }
  });

  it("coerces string numbers for rateOverride", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, rateOverride: "250" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateOverride).toBe(250);
    }
  });

  it("rejects negative rateOverride", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, rateOverride: -10 });
    expect(result.success).toBe(false);
  });

  it("rejects negative estimatedHours", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, estimatedHours: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects startTime exceeding 5 characters", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, startTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects endTime exceeding 5 characters", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, endTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects internalNotes exceeding 2000 characters", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, internalNotes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for crewRoleId", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, crewRoleId: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for rateType", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, rateType: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for serviceId", () => {
    const result = crewAssignmentSchema.safeParse({ ...minimal, serviceId: "" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// crewShiftSchema
// ---------------------------------------------------------------------------
describe("crewShiftSchema", () => {
  const minimal = { date: "2024-06-15" };

  it("accepts valid minimal data", () => {
    const result = crewShiftSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
    }
  });

  it("accepts valid complete data", () => {
    const result = crewShiftSchema.safeParse({
      date: "2024-06-15",
      callTime: "07:30",
      endTime: "18:00",
      breakMinutes: 60,
      location: "Sydney Opera House",
      notes: "Main stage setup",
      status: "COMPLETED",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakMinutes).toBe(60);
      expect(result.data.status).toBe("COMPLETED");
    }
  });

  it("applies default status SCHEDULED", () => {
    const result = crewShiftSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("SCHEDULED");
    }
  });

  it("rejects missing date", () => {
    const result = crewShiftSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("coerces string date to Date", () => {
    const result = crewShiftSchema.safeParse({ date: "2024-12-25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
    }
  });

  it("rejects callTime exceeding 5 characters", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, callTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects endTime exceeding 5 characters", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, endTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("transforms empty string breakMinutes to undefined", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, breakMinutes: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakMinutes).toBeUndefined();
    }
  });

  it("rejects negative breakMinutes", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, breakMinutes: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer breakMinutes", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, breakMinutes: 30.5 });
    expect(result.success).toBe(false);
  });

  it("accepts zero breakMinutes", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, breakMinutes: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakMinutes).toBe(0);
    }
  });

  it("rejects location exceeding 500 characters", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, location: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum", () => {
    const result = crewShiftSchema.safeParse({ ...minimal, status: "ABSENT" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    for (const s of ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const) {
      const result = crewShiftSchema.safeParse({ ...minimal, status: s });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// crewAvailabilitySchema
// ---------------------------------------------------------------------------
describe("crewAvailabilitySchema", () => {
  const minimal = {
    crewMemberId: "cm-1",
    startDate: "2024-07-01",
    endDate: "2024-07-05",
  };

  it("accepts valid minimal data", () => {
    const result = crewAvailabilitySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("accepts valid complete data", () => {
    const result = crewAvailabilitySchema.safeParse({
      ...minimal,
      type: "TENTATIVE",
      reason: "Possible family event",
      isAllDay: false,
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("TENTATIVE");
      expect(result.data.isAllDay).toBe(false);
    }
  });

  it("applies default values", () => {
    const result = crewAvailabilitySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("UNAVAILABLE");
      expect(result.data.isAllDay).toBe(true);
    }
  });

  it("rejects missing crewMemberId", () => {
    const result = crewAvailabilitySchema.safeParse({ startDate: "2024-07-01", endDate: "2024-07-05" });
    expect(result.success).toBe(false);
  });

  it("rejects empty crewMemberId", () => {
    const result = crewAvailabilitySchema.safeParse({ ...minimal, crewMemberId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing startDate", () => {
    const result = crewAvailabilitySchema.safeParse({ crewMemberId: "cm-1", endDate: "2024-07-05" });
    expect(result.success).toBe(false);
  });

  it("rejects missing endDate", () => {
    const result = crewAvailabilitySchema.safeParse({ crewMemberId: "cm-1", startDate: "2024-07-01" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid type enum", () => {
    const result = crewAvailabilitySchema.safeParse({ ...minimal, type: "AVAILABLE" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    for (const t of ["UNAVAILABLE", "TENTATIVE", "PREFERRED"] as const) {
      const result = crewAvailabilitySchema.safeParse({ ...minimal, type: t });
      expect(result.success).toBe(true);
    }
  });

  it("rejects reason exceeding 500 characters", () => {
    const result = crewAvailabilitySchema.safeParse({ ...minimal, reason: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects startTime exceeding 5 characters", () => {
    const result = crewAvailabilitySchema.safeParse({ ...minimal, startTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects endTime exceeding 5 characters", () => {
    const result = crewAvailabilitySchema.safeParse({ ...minimal, endTime: "123456" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// crewTimeEntrySchema
// ---------------------------------------------------------------------------
describe("crewTimeEntrySchema", () => {
  const minimal = {
    crewMemberId: "cm-1",
    date: "2024-06-15",
    startTime: "09:00",
    endTime: "17:00",
  };

  it("accepts valid minimal data", () => {
    const result = crewTimeEntrySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
      expect(result.data.startTime).toBe("09:00");
      expect(result.data.endTime).toBe("17:00");
    }
  });

  it("accepts valid complete data", () => {
    const result = crewTimeEntrySchema.safeParse({
      ...minimal,
      assignmentId: "asgn-1",
      description: "Stage setup work",
      breakMinutes: 30,
      notes: "Completed without issues",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakMinutes).toBe(30);
      expect(result.data.description).toBe("Stage setup work");
    }
  });

  it("rejects missing crewMemberId", () => {
    const result = crewTimeEntrySchema.safeParse({
      date: "2024-06-15",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty crewMemberId", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, crewMemberId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing startTime", () => {
    const result = crewTimeEntrySchema.safeParse({
      crewMemberId: "cm-1",
      date: "2024-06-15",
      endTime: "17:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty startTime", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, startTime: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing endTime", () => {
    const result = crewTimeEntrySchema.safeParse({
      crewMemberId: "cm-1",
      date: "2024-06-15",
      startTime: "09:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty endTime", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, endTime: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing date", () => {
    const result = crewTimeEntrySchema.safeParse({
      crewMemberId: "cm-1",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startTime exceeding 5 characters", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, startTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects endTime exceeding 5 characters", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, endTime: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects description exceeding 500 characters", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, description: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for description", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, description: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for assignmentId", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, assignmentId: "" });
    expect(result.success).toBe(true);
  });

  it("transforms empty string breakMinutes to undefined", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, breakMinutes: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breakMinutes).toBeUndefined();
    }
  });

  it("rejects negative breakMinutes", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, breakMinutes: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer breakMinutes", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, breakMinutes: 15.5 });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = crewTimeEntrySchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });
});
