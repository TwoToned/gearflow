/**
 * Pure helpers for the service sheet's form (spec §8 "the service sheet"). The
 * sheet only ever EDITS a service that already exists (the AddBar creates the
 * row first, `use-quick-add.ts`), so the defaults come from the row itself.
 * No React here: it is tested directly and shared by every section.
 */
import type { ProjectServiceFormValues } from "@/lib/validations/project-service";
import type { LogisticsService } from "@/lib/logistics-model";
import { isClientServiceType } from "../../../../../convex/lib/serviceTypes";

const day = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

/** Form values seeded once per open from the live row. Blank strings, never zero, for blank money. */
export function serviceFormDefaults(s: LogisticsService & { description?: string | null }): ProjectServiceFormValues {
  const full = s as LogisticsService & Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof full[k] === "number" ? (full[k] as number) : undefined);
  return {
    type: s.type,
    title: s.title,
    description: s.description ?? "",
    notes: s.notes ?? "",
    date: day(s.date),
    endDate: day(s.endDate) || day(s.date),
    startTime: s.startTime ?? "",
    endTime: s.endTime ?? "",
    scheduledTime: s.scheduledTime ?? "",
    estimatedDuration: num("estimatedDuration"),
    address: s.address ?? "",
    latitude: s.latitude,
    longitude: s.longitude,
    showOnDocuments: full.showOnDocuments === true,
    quantity: 1,
    taxable: full.taxable !== false,
    unitPrice: num("unitPrice"),
    discount: num("discount"),
    costTotal: num("costTotal"),
    chargeRateOverride: num("chargeRateOverride"),
    vehicleDescription: s.vehicleDescription ?? "",
    numberOfTrips: s.numberOfTrips ?? undefined,
    clientContactName: s.clientContactName ?? "",
    clientContactPhone: s.clientContactPhone ?? "",
    clientVehicle: s.clientVehicle ?? "",
    crewCountRequired: s.crewCountRequired ?? undefined,
    crewRoleId: s.crewRole?.id ?? "",
    xeroAccountCode: (full.xeroAccountCode as string | undefined) || undefined,
    xeroTaxType: (full.xeroTaxType as string | undefined) || undefined,
  };
}

export type ServiceKind = "client" | "transport" | "multiDay" | "site";

/** Which Where / When variant a type gets; one place so every section agrees. */
export function serviceKind(type: string): ServiceKind {
  if (isClientServiceType(type)) return "client";
  if (type === "DELIVERY" || type === "PICKUP") return "transport";
  if (type === "BUMP_IN" || type === "BUMP_OUT" || type === "LABOUR") return "multiDay";
  return "site";
}

/** Distinct vehicles already used on this org's services (derived on read, newest-first order kept). */
export function recentVehicles(services: { vehicleDescription: string | null }[]): string[] {
  return Array.from(new Set(services.map((s) => (s.vehicleDescription ?? "").trim()).filter(Boolean)));
}

/** Live margin: charge minus cost, or null while either side is unknown (never a fake 0). */
export function marginOf(charge: number, cost: number): { amount: number; percent: number } | null {
  if (!(charge > 0)) return null;
  return { amount: charge - cost, percent: Math.round(((charge - cost) / charge) * 100) };
}
