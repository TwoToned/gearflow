import { z } from "zod";

export const projectSchema = z.object({
  projectNumber: z.string().max(50).optional().default(""),
  name: z.string().min(1, "Name is required").max(200),
  clientId: z.string().optional(),
  status: z
    .enum([
      "ENQUIRY",
      "QUOTING",
      "QUOTED",
      "CONFIRMED",
      "PREPPING",
      "CHECKED_OUT",
      "ON_SITE",
      "RETURNED",
      "COMPLETED",
      "INVOICED",
      "CANCELLED",
    ])
    .default("ENQUIRY"),
  type: z
    .enum([
      "DRY_HIRE",
      "WET_HIRE",
      "INSTALLATION",
      "TOUR",
      "CORPORATE",
      "THEATRE",
      "FESTIVAL",
      "CONFERENCE",
      "OTHER",
    ])
    .default("OTHER"),
  description: z.string().max(2000).optional(),
  locationId: z.string().optional(),
  siteContactName: z.string().max(200).optional(),
  siteContactPhone: z.string().max(50).optional(),
  siteContactEmail: z
    .string()
    .email("Invalid email")
    .max(200)
    .optional()
    .or(z.literal("")),
  loadInDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  loadInTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  eventStartDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  eventStartTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  eventEndDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  eventEndTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  loadOutDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  loadOutTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  // WS2 (#941) — the two-window date model. projectStartDate/projectEndDate are
  // the gear-committed window (blank by default — falls back to the rental window
  // at read time via getProjectWindow, R-3.1). loadInDate/loadOutDate/event* stay
  // for one rollout cycle as deprecated aliases — see FEATUREDOCS/10.
  projectStartDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  projectStartTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  projectEndDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  projectEndTime: z.union([z.literal(""), z.string()]).optional().transform((v) => (v === "" ? undefined : v)),
  rentalStartDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  rentalEndDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  defaultRentalPeriod: z.enum(["DAILY", "WEEKLY"]).optional(),
  defaultRentalQuantity: z.coerce.number().int().min(1).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  crewNotes: z.string().max(5000).optional(),
  internalNotes: z.string().max(5000).optional(),
  clientNotes: z.string().max(5000).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  depositPercent: z.coerce.number().min(0).max(100).optional(),
  depositPaid: z.coerce.number().min(0).optional(),
  invoicedTotal: z.coerce.number().min(0).optional(),
  tags: z.array(z.string()).default([]),
});

export type ProjectFormValues = z.input<typeof projectSchema>;
