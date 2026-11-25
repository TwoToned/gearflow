/**
 * `<input type="date">` values and the UTC-midnight epoch-ms the Convex writes store for a
 * calendar date. One definition for every date-only field on the People surfaces (a hire's
 * return date, a supplier document's expiry): the same day on every device, whatever the
 * viewer's time zone.
 */
export const toDateInput = (ms: number | null | undefined): string => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));

export const fromDateInput = (s: string): number => new Date(`${s}T00:00:00.000Z`).getTime();
