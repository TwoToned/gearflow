import { describe, it, expect } from "vitest";
import { PAGE_COMMANDS, matchPageCommands } from "@/lib/page-commands";
import { ALL_NAV } from "@/lib/nav";

const allHrefs = () => new Set(PAGE_COMMANDS.flatMap((c) => [c.href, ...(c.children ?? []).map((k) => k.href)]));

describe("palette @ pages come from NAV", () => {
  it("has an entry for every NAV row and sub-row (nothing the sidebar has is unreachable)", () => {
    const hrefs = allHrefs();
    const missing = ALL_NAV.flatMap((i) => [i.url, ...(i.subs ?? []).map((s) => s.url)]).filter((u) => !hrefs.has(u));
    expect(missing).toEqual([]);
  });

  it("labels are NAV's (Jobs/Home/Schedule/Activity), not a second copy", () => {
    const labels = PAGE_COMMANDS.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Home", "Jobs", "Schedule", "Activity", "Finance"]));
    expect(labels).not.toContain("Activity Log");
  });

  it("keeps palette-only extras and finds the NAV-only pages by name", () => {
    const crew = PAGE_COMMANDS.find((c) => c.href === "/crew")!;
    expect(crew.children!.some((c) => c.label === "Roles & Skills")).toBe(true);
    expect(matchPageCommands("finance").some((m) => m.command.href === "/finance")).toBe(true);
    expect(matchPageCommands("overbookings").some((m) => m.command.href === "/overbookings")).toBe(true);
    expect(matchPageCommands("returns").some((m) => m.command.href === "/warehouse?mode=returning")).toBe(true);
  });

  it("does not offer My tasks as a page", () => {
    expect(allHrefs().has("/my-tasks")).toBe(false);
  });
});
