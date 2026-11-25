// @vitest-environment node
import { describe, expect, test } from "vitest";
import { indexTaskLinks, linkChipText, linkTargetKey, type TaskLink } from "@/lib/task-links";

const l = (id: string, taskId: string, kind: TaskLink["kind"], linkedId: string, label = id): TaskLink => ({ id, taskId, taskTitle: taskId, kind, linkedId, label });

describe("indexTaskLinks", () => {
  test("groups by task and by target, so every surface reads one read", () => {
    const idx = indexTaskLinks([l("a", "t1", "file", "m1"), l("b", "t1", "lineItem", "li1"), l("c", "t2", "file", "m1")]);
    expect(idx.byTask.get("t1")?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(idx.byTarget.get(linkTargetKey("file", "m1"))?.map((x) => x.taskId)).toEqual(["t1", "t2"]);
    expect(idx.byTarget.get(linkTargetKey("discussion", "m1"))).toBeUndefined(); // the kind is part of the key
  });

  test("no links is empty, not an error", () => {
    expect(indexTaskLinks(undefined).byTask.size).toBe(0);
  });
});

describe("linkChipText", () => {
  test("clips a long label so a file name cannot stretch a row", () => {
    expect(linkChipText({ label: "short" })).toBe("short");
    expect(linkChipText({ label: "x".repeat(40) })).toHaveLength(28);
    expect(linkChipText({ label: "x".repeat(40) }).endsWith("…")).toBe(true);
  });
});
