// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("@/hooks/use-project-crew", () => ({ useProjectCrew: () => ({}), useProjectCrewLiveSync: () => {} }));
vi.mock("@/hooks/use-project-detail", () => ({ useProjectDetail: () => ({}) }));
vi.mock("@/hooks/use-project-services", () => ({ useProjectServices: () => ({}), useProjectServicesLiveSync: () => {}, useProjectServicesSummary: () => ({}) }));
vi.mock("@/hooks/use-service-templates", () => ({ useServiceTemplates: () => ({}) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({}) }));
vi.mock("./../use-subhire-stops", () => ({ useSubHireStops: () => [] }));

import { isoOrNull, normaliseCrew, normaliseServices } from "../use-logistics-data";
import { dayKeyOf } from "@/lib/logistics-model";

describe("server-action dates reach the row model as ISO strings", () => {
  it("accepts a Date, an epoch number or a string, and null otherwise", () => {
    const d = new Date("2026-11-24T00:00:00.000Z");
    expect(isoOrNull(d)).toBe("2026-11-24T00:00:00.000Z");
    expect(isoOrNull(d.getTime())).toBe("2026-11-24T00:00:00.000Z");
    expect(isoOrNull("2026-11-24T00:00:00.000Z")).toBe("2026-11-24T00:00:00.000Z");
    expect(isoOrNull(undefined)).toBeNull();
    expect(isoOrNull("")).toBeNull();
  });

  it("a service with a Date date can be sliced like the model expects (the live crash)", () => {
    const [s] = normaliseServices([{ id: "s1", date: new Date("2026-11-24T00:00:00.000Z"), endDate: null, crewAssignments: undefined }]);
    expect((s.date ?? "").slice(0, 10)).toBe("2026-11-24");
    expect(dayKeyOf(s.date)).toBe("2026-11-24");
    expect(s.crewAssignments).toEqual([]);
  });

  it("crew call dates are normalised too", () => {
    const [a] = normaliseCrew([{ id: "a1", startDate: new Date("2026-11-24T00:00:00.000Z"), endDate: undefined }]);
    expect([a.startDate, a.endDate]).toEqual(["2026-11-24T00:00:00.000Z", null]);
  });
});
