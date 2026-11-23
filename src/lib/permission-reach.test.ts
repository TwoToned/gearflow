import { describe, expect, it } from "vitest";
import { reachesResource } from "@/lib/permission-reach";
import { canOpenLink, DASHBOARD_LINKS } from "@/lib/dashboard-links";
import { visibleNav } from "@/lib/nav";

describe("reachesResource — the ONE client 'can open' rule", () => {
  it("any action opens; none, an unknown resource or unknown permissions do not", () => {
    expect(reachesResource({ reports: ["view"] }, "reports")).toBe(true);
    expect(reachesResource({ invoice: ["create"] }, "invoice")).toBe(true);
    expect(reachesResource({ invoice: [] }, "invoice")).toBe(false);
    expect(reachesResource({}, "invoice")).toBe(false);
    expect(reachesResource(null, "invoice")).toBe(false);
  });

  it("the shell's nav and Home's links agree with it for a role holding an action other than read", () => {
    const perms = { invoice: ["create"], reports: ["view"] };
    expect(visibleNav(perms).some((i) => i.key === "finance")).toBe(true);
    expect(canOpenLink(DASHBOARD_LINKS.invoicesOverdue, perms)).toBe(true);
    expect(canOpenLink(DASHBOARD_LINKS.activity, perms)).toBe(true);
  });
});
