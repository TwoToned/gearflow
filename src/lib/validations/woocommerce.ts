import { z } from "zod";

/**
 * WooCommerce order-webhook payload (R-8.2.3): the trust-boundary schema for
 * `POST /api/integrations/woocommerce/webhook`. HMAC signature verification
 * only proves the sender holds the shared secret — it says nothing about the
 * JSON *shape*, so the raw parsed body is validated here before any field is
 * read. Only the fields this integration actually reads are modeled; every
 * other WooCommerce order field is silently dropped by `z.object`'s default
 * (non-strict) behavior, matching the old hand-cast interface's behavior of
 * ignoring unknown keys.
 */
const wooMetaDataItemSchema = z.object({
  key: z.string(),
  // WooCommerce meta values are usually strings but can arrive as numbers/
  // booleans for some plugins — coerce rather than reject, since every
  // consumer of `.value` here (extractDates/resolveLocation/notes) treats it
  // as a string.
  value: z.coerce.string(),
});

const wooBillingSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  company: z.string().optional(),
  email: z.string(),
  phone: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
});

const wooLineItemSchema = z.object({
  name: z.string(),
  sku: z.string().optional(),
  quantity: z.number(),
  price: z.string(),
  meta_data: z.array(wooMetaDataItemSchema).optional(),
});

export const wooOrderSchema = z.object({
  id: z.number(),
  number: z.string().optional(),
  status: z.string().optional(),
  billing: wooBillingSchema,
  customer_note: z.string().optional(),
  line_items: z.array(wooLineItemSchema),
  meta_data: z.array(wooMetaDataItemSchema).optional(),
});

export type WooOrder = z.infer<typeof wooOrderSchema>;

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
