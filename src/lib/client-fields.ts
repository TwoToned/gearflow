import type { ClientFormValues } from "@/lib/validations/client";

/**
 * Map validated client form values → the Convex client field payload (null → absent).
 * Plain module so both the browser-direct write hook (`use-native-client-writes.ts`)
 * and any server code share one mapping. (Was inline in the deleted clients.ts write
 * actions.)
 */
export type ClientFieldsInput = Partial<ClientFormValues> & { name: string };

/**
 * WS9 #948 — `contactName`/`contactEmail`/`contactPhone` are deliberately OMITTED
 * here even though `ClientFormValues` still carries them (the Zod schema/Convex
 * arg keep the fields for the widen-migrate-narrow window — narrowing them off is
 * a separate follow-up). The child `clientContacts` table is now the single
 * write path for a client's contact info ("no dual-write" — see
 * FEATUREDOCS/63-client-contacts.md); callers that collect a primary contact at
 * create-time (ClientForm, QuickCreateClient) write it via a SEPARATE
 * `clientContactWrites.addNative` call after the client itself is created — see
 * `useClientWrites().create()`.
 */
export function toClientFields(parsed: ClientFieldsInput) {
  return {
    name: parsed.name,
    type: parsed.type,
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
