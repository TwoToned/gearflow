/**
 * Job status groups that are read on BOTH sides of the Convex boundary. Pure
 * (no Convex imports), so a browser module can import it without pulling server
 * code into the bundle — `lib/projectSegments.ts` can't be that module, it
 * imports a query module for the derived "needs you" set.
 */

/** Booked: agreed and held, not yet out. The Jobs `booked` segment (`lib/projectSegments.ts`). */
export const BOOKED_STATUSES = ["AWAITING_PAYMENT", "CONFIRMED", "PREPPING"] as const;

/**
 * What Home's Upcoming lists (`dashboardLists.upcoming`): quoted plus booked,
 * starting from now. Its `View all ›` opens the Jobs list filtered to exactly
 * these statuses (`src/lib/dashboard-links.ts`), so the list always contains
 * every row the widget showed — `?seg=booked` dropped the quoted ones.
 */
export const HOME_UPCOMING_STATUSES = ["QUOTED", ...BOOKED_STATUSES] as const;

/** `dashboardLists.upcoming` returns at most this many rows; the widget header prints `n+` once it got that many. */
export const HOME_UPCOMING_LIMIT = 8;
