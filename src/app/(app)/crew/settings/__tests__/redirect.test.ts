import { describe, it, expect, vi } from "vitest";

/**
 * UX Phase 15 (Q-I7): `/crew/settings` is a server redirect to the Crew roles
 * & rates sheet over the planner, so old links and bookmarks keep working.
 * The sheet itself is covered by `crew-roles-sheet.smoke.test.tsx`.
 */
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import CrewSettingsRedirect from "../page";

describe("/crew/settings", () => {
  it("redirects to /crew/planner?sheet=roles", () => {
    CrewSettingsRedirect();
    expect(redirect).toHaveBeenCalledWith("/crew/planner?sheet=roles");
  });
});
