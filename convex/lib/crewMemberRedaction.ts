import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { callerMay, getAuthContext, redactFields } from "./auth";
import { canSeeCrewPay } from "./crewPayVisibility";
import { MEMBER_RATE_FIELDS } from "./crewPayFields";

/**
 * THE field-level read boundary for every crew-member read (`crewMembers.list`,
 * `listPage`, `getById`, `crew.memberDetail`). Resolved once per call, applied
 * per row. The service identity gets the full row; everyone else:
 *
 * - `icalToken` — the bearer secret for the public, unauthenticated calendar
 *   feed (`/api/crew/calendar/[token]`): whoever holds it reads that person's
 *   schedule. It goes to exactly two callers, and only on a USER session:
 *   the member themself (the row's linked `userId`), and a caller with
 *   `crew:update` (who enables, disables and regenerates feed links). An API
 *   key / agent never gets it, even acting as such a user — a feed link is for
 *   a person's calendar app, not an integration. Everyone else: field absent.
 * - the default rates (`MEMBER_RATE_FIELDS`) unless `canSeeCrewPay` (the ONE
 *   crew-pay rule: manager+ AND not a `noFinancials` key).
 */
export async function memberRowRedactor(
  ctx: QueryCtx,
  orgId: string,
): Promise<<R extends Doc<"crewMembers">>(row: R) => R> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind === "service") return (row) => row;
  const pay = await canSeeCrewPay(ctx, orgId);
  const user = auth?.kind === "user" && auth.orgId === orgId ? auth : null;
  const managesFeeds = user ? await callerMay(ctx, orgId, "crew", "update") : false;
  return (row) => {
    const seesFeed = !!user && (managesFeeds || (row.userId != null && row.userId === user.userId));
    const fields = [...(seesFeed ? [] : ["icalToken"]), ...(pay ? [] : MEMBER_RATE_FIELDS)];
    return fields.length === 0 ? row : redactFields(row, fields);
  };
}
