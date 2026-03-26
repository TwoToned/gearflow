import { z } from "zod";

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
  billableToClient: z.boolean().default(false),
  costTotal: z.coerce.number().min(0).optional(),

  vehicleDescription: z.string().optional(),
  numberOfTrips: z.coerce.number().optional(),

  crewCountRequired: z.coerce.number().optional(),
  crewRoleId: z.string().optional(),
  crewMemberIds: z.array(z.string()).optional(),
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
