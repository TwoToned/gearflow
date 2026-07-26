import { z } from "zod";

export const crewMemberSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(200),
  lastName: z.string().min(1, "Last name is required").max(200),
  email: z.string().email().max(200).optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  type: z.enum(["EMPLOYEE", "FREELANCER", "CONTRACTOR", "VOLUNTEER"]).default("FREELANCER"),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "ARCHIVED"]).default("ACTIVE"),
  department: z.string().max(100).optional(),
  crewRoleId: z.string().optional().or(z.literal("")),
  defaultDayRate: z.union([z.literal(""), z.coerce.number().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  defaultHourlyRate: z.union([z.literal(""), z.coerce.number().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  overtimeMultiplier: z.union([z.literal(""), z.coerce.number().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  currency: z.string().max(10).optional(),
  address: z.string().max(500).optional(),
  addressLatitude: z.union([z.null(), z.coerce.number()]).optional(),
  addressLongitude: z.union([z.null(), z.coerce.number()]).optional(),
  emergencyContactName: z.string().max(200).optional(),
  emergencyContactPhone: z.string().max(50).optional(),
  dateOfBirth: z.union([z.literal(""), z.coerce.date()]).optional()
    .transform(v => v === "" ? undefined : v),
  abnOrGst: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string()).default([]),
  userId: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
}).refine(
  (data) => (data.addressLatitude != null) === (data.addressLongitude != null),
  { message: "Both latitude and longitude must be provided together" }
);

export type CrewMemberFormValues = z.input<typeof crewMemberSchema>;

/**
 * Rate-cascade input fields shared by any form that can set a CrewAssignment's rate
 * (the crew-panel assignment dialog + the per-service crew rate table in
 * services-panel.tsx) — single source of truth for these bounds (R-8.6.3/R-3.1).
 * Mirrors convex/lib/crewRate.ts's cascade inputs (rateOverride/rateType/estimatedHours).
 */
export const crewRateFieldsSchema = {
  rateOverride: z.union([z.literal(""), z.coerce.number().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  rateType: z.enum(["HOURLY", "DAILY", "FLAT"]).optional().or(z.literal("")),
  estimatedHours: z.union([z.literal(""), z.coerce.number().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
};

export const crewAssignmentSchema = z.object({
  crewMemberId: z.string().min(1, "Crew member is required"),
  crewRoleId: z.string().optional().or(z.literal("")),
  status: z.enum(["PENDING", "OFFERED", "ACCEPTED", "DECLINED", "CONFIRMED", "CANCELLED", "COMPLETED"]).default("PENDING"),
  phase: z.enum(["BUMP_IN", "EVENT", "BUMP_OUT", "DELIVERY", "PICKUP", "SETUP", "REHEARSAL", "FULL_DURATION"]).optional().or(z.literal("")),
  isProjectManager: z.boolean().default(false),
  startDate: z.union([z.literal(""), z.coerce.date()]).optional()
    .transform(v => v === "" ? undefined : v),
  startTime: z.string().max(5).optional(),
  endDate: z.union([z.literal(""), z.coerce.date()]).optional()
    .transform(v => v === "" ? undefined : v),
  endTime: z.string().max(5).optional(),
  ...crewRateFieldsSchema,
  notes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  generateShifts: z.boolean().default(false),
  serviceId: z.string().optional().or(z.literal("")),
});

export type CrewAssignmentFormValues = z.input<typeof crewAssignmentSchema>;

export const crewShiftSchema = z.object({
  date: z.coerce.date(),
  callTime: z.string().max(5).optional(),
  endTime: z.string().max(5).optional(),
  breakMinutes: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).default("SCHEDULED"),
});

export type CrewShiftFormValues = z.input<typeof crewShiftSchema>;

export const crewAvailabilitySchema = z.object({
  crewMemberId: z.string().min(1, "Crew member is required"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  type: z.enum(["UNAVAILABLE", "TENTATIVE", "PREFERRED"]).default("UNAVAILABLE"),
  reason: z.string().max(500).optional(),
  isAllDay: z.boolean().default(true),
  startTime: z.string().max(5).optional(),
  endTime: z.string().max(5).optional(),
});

export type CrewAvailabilityFormValues = z.input<typeof crewAvailabilitySchema>;

export const crewTimeEntrySchema = z.object({
  assignmentId: z.string().optional().or(z.literal("")),
  crewMemberId: z.string().min(1, "Crew member is required"),
  description: z.string().max(500).optional().or(z.literal("")),
  date: z.coerce.date(),
  startTime: z.string().min(1, "Start time is required").max(5),
  endTime: z.string().min(1, "End time is required").max(5),
  breakMinutes: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional()
    .transform(v => v === "" ? undefined : v),
  notes: z.string().max(2000).optional(),
});

export type CrewTimeEntryFormValues = z.input<typeof crewTimeEntrySchema>;
