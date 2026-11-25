import { describe, it, expect } from "vitest";
import { jobEditHref, jobEditCloseHref } from "./job-edit-url";

describe("job edit url", () => {
  it("opens the sheet and keeps the current tab", () => {
    expect(jobEditHref("/projects/p1", "tab=labour")).toBe("/projects/p1?tab=labour&edit=1");
    expect(jobEditHref("/projects/p1")).toBe("/projects/p1?edit=1");
  });
  it("is idempotent when already open", () => {
    expect(jobEditHref("/projects/p1", new URLSearchParams("edit=1&tab=equipment"))).toBe("/projects/p1?edit=1&tab=equipment");
  });
  it("closes back to the same URL without the param", () => {
    expect(jobEditCloseHref("/projects/p1", "edit=1&tab=equipment")).toBe("/projects/p1?tab=equipment");
    expect(jobEditCloseHref("/projects/p1", "edit=1")).toBe("/projects/p1");
  });
});
