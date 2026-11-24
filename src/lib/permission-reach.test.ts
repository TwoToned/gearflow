import { describe, expect, it } from "vitest";
import { canReadResource, reachesResource } from "@/lib/permission-reach";
import { NAV_COUNT_RESOURCE } from "@/lib/nav-counts";
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

describe("canReadResource — the gate for a data read", () => {
  it("only the read action reads; any other action shows the place but reads nothing", () => {
    expect(canReadResource({ invoice: ["read"] }, "invoice")).toBe(true);
    expect(canReadResource({ invoice: ["create"] }, "invoice")).toBe(false);
    expect(canReadResource({ reports: ["view"] }, "reports")).toBe(false);
    expect(canReadResource({}, "invoice")).toBe(false);
    expect(canReadResource(null, "invoice")).toBe(false);
  });

  it("every More-sheet count names the resource it reads (the server's own)", () => {
    expect(NAV_COUNT_RESOURCE.invoicesOverdue).toBe("invoice");
    expect(NAV_COUNT_RESOURCE.overbookings).toBe("project");
    expect(NAV_COUNT_RESOURCE.returnsOverdue).toBe("warehouse");
  });
});
