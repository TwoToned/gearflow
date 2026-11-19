/**
 * Shapes the project detail into the two small value objects the Logistics tab
 * reads (dates and site facts). Read from the LIVE project row: services and
 * crew are never versioned, so the version overlay does not apply here.
 */
import type { SiteFacts } from "./facts";
import type { ScheduleSnapshot } from "./dates-sheet";

type Raw = Record<string, unknown> | null | undefined;

const day = (v: unknown): string => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function scheduleFromProject(p: Raw): ScheduleSnapshot {
  return {
    rentalStart: day(p?.rentalStartDate),
    rentalEnd: day(p?.rentalEndDate),
    loadIn: day(p?.projectStartDate),
    loadInTime: str(p?.projectStartTime),
    loadOut: day(p?.projectEndDate),
    loadOutTime: str(p?.projectEndTime),
  };
}

export function siteFromProject(p: Raw): SiteFacts {
  const loc = (p?.location ?? null) as Record<string, unknown> | null;
  return {
    venue: str(loc?.name),
    address: str(loc?.address),
    access: str(loc?.notes),
    contactName: str(p?.siteContactName),
    contactPhone: str(p?.siteContactPhone),
    contactEmail: str(p?.siteContactEmail),
  };
}
