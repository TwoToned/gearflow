import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helper for the ClientContact child table (WS9 #948) — mirrors
 * `clients-read.ts`. Used wherever a server-rendered path needs a client's
 * contacts (PDF token resolution, WooCommerce matching).
 */
export type ConvexClientContact = Doc<"clientContacts">;

export async function getClientContactsByClientId(
  clientId: string,
  organizationId: string,
): Promise<ConvexClientContact[]> {
  return await (await getConvexClient()).query(api.clientContacts.listByClientId, { clientId, organizationId });
}

/** All of an org's contacts in one round trip (WooCommerce matching). */
export async function getClientContactsByOrg(organizationId: string): Promise<ConvexClientContact[]> {
  return await (await getConvexClient()).query(api.clientContacts.listByOrg, { organizationId });
}
