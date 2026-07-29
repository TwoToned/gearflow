import { describe, test, expect } from "vitest";
import { routeMiraQuestion } from "./intent-router";

describe("routeMiraQuestion", () => {
  test("routes to the project bundle when the page context names a project", () => {
    const route = routeMiraQuestion("what's the status?", { entityType: "project", entityId: "proj_1" });
    expect(route).toEqual({ operation: "projectDetail.bundle", args: { projectId: "proj_1" } });
  });

  test("an asset-shaped question wins over project page context", () => {
    const route = routeMiraQuestion("list my assets", { entityType: "project", entityId: "proj_1" });
    expect(route).toEqual({ operation: "assets.list", args: {} });
  });

  test("routes to assets.list with no page context at all", () => {
    expect(routeMiraQuestion("what equipment do we have?", null)).toEqual({ operation: "assets.list", args: {} });
  });

  test("returns null when nothing matches and there's no project context", () => {
    expect(routeMiraQuestion("what's the weather like", null)).toBeNull();
  });

  test("ignores project context missing an entityId", () => {
    expect(routeMiraQuestion("what's up", { entityType: "project" })).toBeNull();
  });

  test("ignores project context for a different entityType", () => {
    expect(routeMiraQuestion("what's up", { entityType: "asset", entityId: "a1" })).toBeNull();
  });
});
