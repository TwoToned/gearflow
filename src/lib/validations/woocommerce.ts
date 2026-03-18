import { z } from "zod";

export const wooCommerceIntegrationSchema = z.object({
  isEnabled: z.boolean().default(false),
  storeUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  productMatchField: z.enum(["sku", "custom_field", "name"]).default("sku"),
  customFieldKey: z.string().max(100).optional(),
  rentalStartKey: z.string().max(100).optional(),
  rentalEndKey: z.string().max(100).optional(),
  eventStartKey: z.string().max(100).optional(),
  deliveryAddressKey: z.string().max(100).optional(),
  notesKey: z.string().max(100).optional(),
  locationMetaKey: z.string().max(100).optional(),
  defaultLocationId: z.string().optional().or(z.literal("")),
  dateFormat: z.enum(["auto", "DD/MM/YYYY", "MM/DD/YYYY", "ISO"]).default("auto"),
  defaultProjectType: z.enum([
    "DRY_HIRE", "WET_HIRE", "INSTALLATION", "TOUR",
    "CORPORATE", "THEATRE", "FESTIVAL", "CONFERENCE", "OTHER",
  ]).default("DRY_HIRE"),
  autoConfirmEnquiry: z.boolean().default(false),
  notifyUserIds: z.array(z.string()).default([]),
});

export type WooCommerceIntegrationFormValues = z.input<typeof wooCommerceIntegrationSchema>;
