/**
 * The ONE list of service types (R-3.1). The Zod schema, the Logistics model,
 * the settings page and the constants all derive from this tuple; a test pins
 * the Convex validator (`validators.ts` `ServiceType`) to it so a new type
 * cannot be added in one place only.
 *
 * `CLIENT_PICKUP` / `CLIENT_DROPOFF` (UX 5b): the client moves the gear
 * themselves at our counter. They sit in the Transport lane, staff the
 * counter, and use the HANDOVER / RETURN crew phases.
 */
export const SERVICE_TYPES = [
  "DELIVERY",
  "PICKUP",
  "CLIENT_PICKUP",
  "CLIENT_DROPOFF",
  "BUMP_IN",
  "BUMP_OUT",
  "LABOUR",
  "MISC",
] as const;

export type ServiceTypeValue = (typeof SERVICE_TYPES)[number];

export function isClientServiceType(type: string | null | undefined): boolean {
  return type === "CLIENT_PICKUP" || type === "CLIENT_DROPOFF";
}
