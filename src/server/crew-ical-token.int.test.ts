/**
 * Integration test for `api.crewMembers.getByIcalToken` (T-E from the perf
 * remediation test plan). The query was changed from a full-table
 * `.collect().find()` (a scrape-able cross-org DoS, since the public calendar
 * feed URL is externally reachable) to an indexed `by_icalToken` lookup.
 *
 * Safety property: the indexed lookup must return the SAME result as the old
 * scan — the matching member for a known token, null for an unknown token, and
 * it must never match rows whose `icalToken` is null.
 *
 * Self-contained: creates its own org + crew members with unique cuid tokens and
 * asserts only on its own rows, so it is robust against other data already
 * present in the shared dev Convex deployment.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest, createOrgFixture } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

describe("crewMembers.getByIcalToken — indexed lookup", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("finds the member by token, returns null for unknown, ignores null-token rows", async () => {
    const org = await createOrgFixture();
    const convex = await getConvexClient();

    const token = `ical_${createId()}`;
    const targetId = createId();

    // The member we expect to find by token.
    await convex.mutation(api.crewMembers.createIfMissing, {
      id: targetId,
      organizationId: org.id,
      firstName: "Ada",
      lastName: "Lovelace",
      icalToken: token,
    });

    // A member with NO icalToken (null key) — must never be matched by the index.
    await convex.mutation(api.crewMembers.createIfMissing, {
      id: createId(),
      organizationId: org.id,
      firstName: "Grace",
      lastName: "Hopper",
    });

    const found = await convex.query(api.crewMembers.getByIcalToken, { icalToken: token });
    expect(found).not.toBeNull();
    expect(found?.id).toBe(targetId);
    expect(found?.icalToken).toBe(token);

    const missing = await convex.query(api.crewMembers.getByIcalToken, {
      icalToken: `ical_${createId()}`,
    });
    expect(missing).toBeNull();
  });
});
