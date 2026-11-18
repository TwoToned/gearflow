import { describe, it, expect } from "vitest";
import { buildTrail, isIdSegment } from "@/lib/breadcrumbs";

const CUID = "cm1abcdefghijklmnopqrstuv";
const labels = (t: ReturnType<typeof buildTrail>) => t.map((c) => c.label);

describe("buildTrail", () => {
  it("a module root is one ink crumb with the NAV label (Jobs, never Projects)", () => {
    expect(buildTrail("/projects")).toEqual([{ label: "Jobs" }]);
    expect(buildTrail("/availability")).toEqual([{ label: "Schedule" }]);
    expect(buildTrail("/dashboard")).toEqual([{ label: "Home" }]);
  });

  it("a job page reads Jobs › entity, each earlier segment a link, never the raw id", () => {
    const t = buildTrail(`/projects/${CUID}`, "#2341 Hilton Sydney gala dinner");
    expect(t).toEqual([{ label: "Jobs", href: "/projects" }, { label: "#2341 Hilton Sydney gala dinner" }]);
    expect(labels(buildTrail(`/projects/${CUID}`))).toEqual(["Jobs"]); // label not registered yet
    expect(JSON.stringify(buildTrail(`/projects/${CUID}`))).not.toContain(CUID);
  });

  it("walks sub-pages and create/edit words", () => {
    expect(buildTrail("/assets/models/new")).toEqual([
      { label: "Assets", href: "/assets/registry" },
      { label: "Models", href: "/assets/models" },
      { label: "New" },
    ]);
    expect(buildTrail(`/clients/${CUID}/edit`, "Hilton")).toEqual([
      { label: "Clients", href: "/clients" },
      { label: "Hilton", href: `/clients/${CUID}` },
      { label: "Edit" },
    ]);
  });

  it("an asset detail sits under Assets; a kit under Assets › Kits", () => {
    expect(labels(buildTrail(`/assets/registry/${CUID}`, "AURA-01"))).toEqual(["Assets", "AURA-01"]);
    expect(labels(buildTrail(`/kits/${CUID}`, "K-1"))).toEqual(["Assets", "Kits", "K-1"]);
  });

  it("settings sub-pages are labelled words", () => {
    expect(labels(buildTrail("/settings/api-keys"))).toEqual(["Settings", "API keys"]);
    expect(labels(buildTrail("/settings/team"))).toEqual(["Settings", "Team"]);
  });

  it("routes outside NAV still get a trail", () => {
    expect(labels(buildTrail("/account/notifications"))).toEqual(["Account", "Notifications"]);
  });

  it("recognises record ids", () => {
    expect(isIdSegment(CUID)).toBe(true);
    expect(isIdSegment("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    expect(isIdSegment("registry")).toBe(false);
    expect(isIdSegment("pull-sheet")).toBe(false);
  });
});
