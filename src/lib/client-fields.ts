import type { ClientFormValues } from "@/lib/validations/client";

/**
 * Map validated client form values → the Convex client field payload (null → absent).
 * Plain module so both the browser-direct write hook (`use-native-client-writes.ts`)
 * and any server code share one mapping. (Was inline in the deleted clients.ts write
 * actions.)
 */
export type ClientFieldsInput = Partial<ClientFormValues> & { name: string };

export function toClientFields(parsed: ClientFieldsInput) {
  return {
    name: parsed.name,
    type: parsed.type,
    contactName: parsed.contactName || undefined,
    contactEmail: parsed.contactEmail || undefined,
    contactPhone: parsed.contactPhone || undefined,
    billingAddress: parsed.billingAddress || undefined,
    billingLatitude: parsed.billingLatitude == null ? undefined : Number(parsed.billingLatitude),
    billingLongitude: parsed.billingLongitude == null ? undefined : Number(parsed.billingLongitude),
    shippingAddress: parsed.shippingAddress || undefined,
    shippingLatitude: parsed.shippingLatitude == null ? undefined : Number(parsed.shippingLatitude),
    shippingLongitude: parsed.shippingLongitude == null ? undefined : Number(parsed.shippingLongitude),
    taxId: parsed.taxId || undefined,
    paymentTerms: parsed.paymentTerms || undefined,
    defaultDiscount: parsed.defaultDiscount == null ? undefined : Number(parsed.defaultDiscount),
    notes: parsed.notes || undefined,
    tags: parsed.tags,
    isActive: parsed.isActive,
  };
}
