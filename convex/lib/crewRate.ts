/**
 * Convex-native port of the crew-assignment rate cascade (src/server/crew-assignments.ts
 * resolveRate + calculateEstimatedCost). Pure. Dates are epoch-ms on Convex docs (the
 * old server used Date; ms math is equivalent). Priority: rateOverride → member day →
 * member hourly → role default → 0.
 */

export function resolveRate(
  rateOverride: number | null | undefined,
  rateType: string | null | undefined,
  crewMember: { defaultDayRate?: number | null; defaultHourlyRate?: number | null },
  crewRole: { defaultRate?: number | null; rateType?: string | null } | null,
): { rate: number; rateType: string } {
  if (rateOverride != null && rateOverride > 0) return { rate: rateOverride, rateType: rateType || "DAILY" };
  if (crewMember.defaultDayRate != null && Number(crewMember.defaultDayRate) > 0) return { rate: Number(crewMember.defaultDayRate), rateType: "DAILY" };
  if (crewMember.defaultHourlyRate != null && Number(crewMember.defaultHourlyRate) > 0) return { rate: Number(crewMember.defaultHourlyRate), rateType: "HOURLY" };
  if (crewRole?.defaultRate != null && Number(crewRole.defaultRate) > 0) return { rate: Number(crewRole.defaultRate), rateType: crewRole.rateType || "DAILY" };
  return { rate: 0, rateType: "DAILY" };
}

/** Estimated cost. startMs/endMs are epoch-ms (or null); FLAT = rate, HOURLY = rate*hours, DAILY = rate*days. */
export function calculateEstimatedCost(
  rate: number,
  rateType: string,
  startMs: number | null | undefined,
  endMs: number | null | undefined,
  estimatedHours: number | null | undefined,
): number {
  if (rate === 0) return 0;
  if (rateType === "FLAT") return rate;
  if (rateType === "HOURLY") return rate * (estimatedHours || 0);
  if (startMs != null && endMs != null) {
    const days = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
    return rate * days;
  }
  return rate;
}
