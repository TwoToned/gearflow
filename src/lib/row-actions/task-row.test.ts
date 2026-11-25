// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { buildTaskRowActions } from "@/lib/row-actions/task-row";

const h = () => ({ onEdit: vi.fn(), onToggleDone: vi.fn(), onSetDue: vi.fn(), onDelete: vi.fn() });
const keys = (s: { items: { key: string }[] }) => s.items.map((i) => i.key);

describe("buildTaskRowActions", () => {
  test("an open task offers Edit, Mark done, Due and a last, danger Delete with no confirm (Undo covers it)", () => {
    const spec = buildTaskRowActions({ status: "TODO", dueDate: null }, h());
    expect(keys(spec)).toEqual(["edit", "done", "due", "delete"]);
    const del = spec.items[3];
    expect(del.danger).toBe(true);
    expect(del.confirm).toBeUndefined();
  });

  test("a done task offers Reopen instead of Mark done", () => {
    expect(keys(buildTaskRowActions({ status: "DONE", dueDate: null }, h()))).toEqual(["edit", "reopen", "due", "delete"]);
  });

  test("the Due submenu offers No date only when a date is set", () => {
    const sub = (due: string | null) => buildTaskRowActions({ status: "TODO", dueDate: due }, h()).items[2].children!.map((i) => i.key);
    expect(sub(null)).toEqual(["due-today", "due-tomorrow", "due-next-week"]);
    expect(sub("2026-11-24T00:00:00.000Z")).toEqual(["due-today", "due-tomorrow", "due-next-week", "due-clear"]);
  });
});
