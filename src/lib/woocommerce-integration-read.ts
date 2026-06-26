import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helper for the WooCommerceIntegration domain (Phase C config
 * leftover inversion). `wooCommerceIntegration` is now Convex-only — written via
 * api.wooCommerceIntegrations.* in src/server/woocommerce.ts and the webhook route.
 *
 * The table is one-per-org (organizationId @unique), so the org's row is the single
 * element of `api.wooCommerceIntegrations.list({ orgId })`. This helper maps the Convex
 * doc back into the Prisma-row shape the old `prisma.wooCommerceIntegration.findUnique`
 * returned (epoch-ms → Date, absent optionals → null).
 */

type RawWooCommerceIntegration = Doc<"wooCommerceIntegrations">;

const toDate = (value: number | undefined): Date | null =>
  typeof value === "number" ? new Date(value) : null;

export interface WooCommerceIntegrationRow {
  id: string;
  organizationId: string;
  isEnabled: boolean;
  webhookSecret: string;
  storeUrl: string | null;
  productMatchField: string;
  customFieldKey: string | null;
  rentalStartKey: string | null;
  rentalEndKey: string | null;
  eventStartKey: string | null;
  deliveryAddressKey: string | null;
  notesKey: string | null;
  dateFormat: string;
  locationMetaKey: string | null;
  defaultLocationId: string | null;
  defaultProjectType: string;
  autoConfirmEnquiry: boolean;
  notifyUserIds: string[];
  lastPayload: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapWooCommerceIntegration(
  d: RawWooCommerceIntegration,
): WooCommerceIntegrationRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    isEnabled: d.isEnabled ?? false,
    webhookSecret: d.webhookSecret ?? "",
    storeUrl: d.storeUrl ?? null,
    productMatchField: d.productMatchField ?? "sku",
    customFieldKey: d.customFieldKey ?? null,
    rentalStartKey: d.rentalStartKey ?? null,
    rentalEndKey: d.rentalEndKey ?? null,
    eventStartKey: d.eventStartKey ?? null,
    deliveryAddressKey: d.deliveryAddressKey ?? null,
    notesKey: d.notesKey ?? null,
    dateFormat: d.dateFormat ?? "auto",
    locationMetaKey: d.locationMetaKey ?? null,
    defaultLocationId: d.defaultLocationId ?? null,
    defaultProjectType: d.defaultProjectType ?? "DRY_HIRE",
    autoConfirmEnquiry: d.autoConfirmEnquiry ?? false,
    notifyUserIds: d.notifyUserIds ?? [],
    lastPayload: d.lastPayload ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/**
 * The org's WooCommerce integration row (or null). Replaces
 * `prisma.wooCommerceIntegration.findUnique({ where: { organizationId } })`.
 */
export async function getWooCommerceIntegrationByOrg(
  orgId: string,
): Promise<WooCommerceIntegrationRow | null> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.wooCommerceIntegrations.list, {
      orgId,
    }),
  )) as RawWooCommerceIntegration[];
  const row = rows[0];
  return row ? mapWooCommerceIntegration(row) : null;
}
