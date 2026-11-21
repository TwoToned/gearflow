/**
 * Query… on a timesheet entry (UX Phase 15, D47). The UI word is `Query`; the
 * status enum stays `DISPUTED`. One bound, shared by the client Zod schema
 * (`timeEntryQuerySchema`, src/lib/validations/crew.ts) and the server mutation
 * (`crewTimeEntriesWrites.queryNative`), so the two cannot drift (R-8.6.1).
 * Plain module: no Convex imports.
 */
export const QUERY_REASON_MAX = 500;
