import { z } from "zod";
import { crewRateFieldsSchema } from "./crew";

/**
 * One row of the per-service crew rate table (services-panel.tsx). Rate fields are
 * the SAME bounds as crewAssignmentSchema (src/lib/validations/crew.ts) — a crew
 * member's rate has exactly one authoritative shape whether it's set from the crew
 * side or the service side (R-3.1 single source of truth, issue #796). Not exported
 * — only composed into projectServiceSchema.crew below; consumers use
 * ProjectServiceFormValues["crew"] for the row type.
 */
const serviceCrewMemberSchema = z.object({
  crewMemberId: z.string().min(1),
  ...crewRateFieldsSchema,
});

export const projectServiceSchema = z.object({
  type: z.enum(["DELIVERY", "PICKUP", "BUMP_IN", "BUMP_OUT", "LABOUR", "MISC"]),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  notes: z.string().optional(),

  date: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  endDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  scheduledTime: z.string().optional(),
  estimatedDuration: z.coerce.number().optional(),

  address: z.string().optional(),
  latitude: z.union([z.null(), z.coerce.number()]).optional(),
  longitude: z.union([z.null(), z.coerce.number()]).optional(),

  showOnDocuments: z.boolean().default(false),
  unitPrice: z.coerce.number().optional(),
  quantity: z.coerce.number().min(1).default(1),
  pricingType: z.enum(["PER_DAY", "PER_HOUR", "FLAT"]).optional().or(z.literal("")),
  duration: z.coerce.number().optional(),
  discount: z.coerce.number().optional(),
  taxable: z.boolean().default(true),
  costTotal: z.coerce.number().min(0).optional(),

  vehicleDescription: z.string().optional(),
  numberOfTrips: z.coerce.number().optional(),

  crewCountRequired: z.coerce.number().optional(),
  crewRoleId: z.string().optional(),
  crew: z.array(serviceCrewMemberSchema).optional(),
});

export type ProjectServiceFormValues = z.input<typeof projectServiceSchema>;

export const serviceTemplateSchema = z.object({
  type: z.enum(["DELIVERY", "PICKUP", "BUMP_IN", "BUMP_OUT", "LABOUR", "MISC"]),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  defaultCrewCount: z.coerce.number().optional(),
  defaultVehicle: z.string().optional(),
  defaultPricingType: z.enum(["PER_DAY", "PER_HOUR", "FLAT"]).optional().or(z.literal("")),
  defaultUnitPrice: z.coerce.number().optional(),
  showOnDocuments: z.boolean().default(false),
  isAutoAdded: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type ServiceTemplateFormValues = z.input<typeof serviceTemplateSchema>;
