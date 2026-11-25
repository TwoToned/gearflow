import { describe, it, expect } from "vitest";
import { JOB_TAB_KEYS, availableJobTabs, jobTabItems, jobTabSection, resolveJobTab, type JobTabKey } from "./job-tabs";

const all = new Set<JobTabKey>(JOB_TAB_KEYS);

describe("job tabs", () => {
  it("a job shows every tab it has a panel for, in strip order, Versions last", () => {
    expect(availableJobTabs({ isTemplate: false, panels: all })).toEqual([...JOB_TAB_KEYS]);
    const noVersions = new Set(JOB_TAB_KEYS.filter((k) => k !== "versions"));
    expect(availableJobTabs({ isTemplate: false, panels: noVersions })).not.toContain("versions");
  });

  it("a template never has Packing, Finance or Versions", () => {
    const t = availableJobTabs({ isTemplate: true, panels: all });
    expect(t).toEqual(["overview", "equipment", "labour", "tasks"]);
  });

  it("resolves ?tab= with aliases and falls back to Overview", () => {
    const a = availableJobTabs({ isTemplate: false, panels: all });
    expect(resolveJobTab("versions", a)).toBe("versions");
    expect(resolveJobTab("work", a)).toBe("tasks");
    expect(resolveJobTab("notes", a)).toBe("tasks");
    expect(resolveJobTab("files", a)).toBe("tasks");
    expect(jobTabSection("files")).toBe("files");
    expect(resolveJobTab("discussion", a)).toBe("tasks");
    expect(jobTabSection("discussion")).toBe("discussion");
    expect(jobTabSection("tasks")).toBeNull();
    expect(resolveJobTab("logistics", a)).toBe("labour");
    expect(resolveJobTab("nope", a)).toBe("overview");
    expect(resolveJobTab(null, a)).toBe("overview");
    // Not available on a template → home, never an empty tab.
    expect(resolveJobTab("finance", availableJobTabs({ isTemplate: true, panels: all }))).toBe("overview");
  });

  it("labels carry the counts their owners feed, and nothing when there is none", () => {
    const items = jobTabItems(JOB_TAB_KEYS, {
      tasks: { done: 9, total: 14, overdue: 2 },
      packing: { planned: 36, total: 44 },
      versions: 3,
    });
    const by = Object.fromEntries(items.map((i) => [i.value, i]));
    expect(by.tasks).toMatchObject({ label: "Tasks & notes", count: "9/14", alert: "2 overdue" });
    expect(by.notes).toBeUndefined();
    expect(by.files).toBeUndefined();
    expect(by.packing.count).toBe("36/44");
    expect(by.versions.count).toBe(3);
    expect(by.labour.label).toBe("Logistics");
    const empty = Object.fromEntries(jobTabItems(JOB_TAB_KEYS, { tasks: { done: 0, total: 0 } }).map((i) => [i.value, i]));
    expect(empty.tasks.count).toBeUndefined();
    expect(empty.packing.count).toBeUndefined();
  });
});
