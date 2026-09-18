// Overview Work card merge logic (#1244, design §8.3). Pure module —
// project-readiness-checks.ts's own check logic is unit-tested separately
// and UNCHANGED; this only tests the merge/stage-bucketing on top of it.
import { describe, test, expect } from "vitest";
import { buildWorkCardStages, summariseWorkCard } from "./project-work-card";
import type { ReadinessCheck } from "./project-readiness-checks";

const passingCheck = (id: ReadinessCheck["id"]): ReadinessCheck => ({ id, severity: "pass", title: "ok" });
const failingCheck = (id: ReadinessCheck["id"], severity: ReadinessCheck["severity"] = "blocking"): ReadinessCheck => ({
  id,
  severity,
  title: `${id} problem`,
  detail: "detail",
  actionLabel: "Fix",
});

describe("buildWorkCardStages", () => {
  test("a passing check contributes no row — only a problem earns one", () => {
    const stages = buildWorkCardStages([passingCheck("gear"), passingCheck("pricing")], []);
    expect(stages).toEqual([]);
  });

  test("a failing check becomes a system row under its mapped stage", () => {
    const stages = buildWorkCardStages([failingCheck("pricing")], []);
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe("quote");
    expect(stages[0].rows[0]).toMatchObject({ id: "check:pricing", system: true, done: false });
  });

  test("gear/conflicts/crew/services checks map to the prep stage", () => {
    const stages = buildWorkCardStages(
      [failingCheck("gear"), failingCheck("conflicts"), failingCheck("crew", "warning"), failingCheck("services", "warning")],
      [],
    );
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe("prep");
    expect(stages[0].rows).toHaveLength(4);
  });

  test("real tasks are grouped by their own stage, cancelled tasks excluded, stageless tasks dropped", () => {
    const stages = buildWorkCardStages(
      [],
      [
        { id: "t1", title: "Send deposit invoice", status: "DONE", stage: "quote" },
        { id: "t2", title: "Book crew", status: "TODO", stage: "prep" },
        { id: "t3", title: "Cancelled thing", status: "CANCELLED", stage: "prep" },
        { id: "t4", title: "No stage", status: "TODO", stage: null },
      ],
    );
    const quote = stages.find((s) => s.stage === "quote")!;
    const prep = stages.find((s) => s.stage === "prep")!;
    expect(quote.rows.map((r) => r.id)).toEqual(["t1"]);
    expect(quote.doneCount).toBe(1);
    expect(prep.rows.map((r) => r.id)).toEqual(["t2"]); // cancelled excluded, stageless never bucketed
  });

  test("checks and tasks in the same stage merge into one list", () => {
    const stages = buildWorkCardStages(
      [failingCheck("pricing")],
      [{ id: "t1", title: "Send deposit invoice", status: "TODO", stage: "quote" }],
    );
    expect(stages).toHaveLength(1);
    expect(stages[0].rows.map((r) => r.id)).toEqual(["check:pricing", "t1"]);
    expect(stages[0].totalCount).toBe(2);
    expect(stages[0].doneCount).toBe(0);
  });

  test("empty stages are dropped entirely (no permanent zero-row sections)", () => {
    const stages = buildWorkCardStages([], [{ id: "t1", title: "X", status: "DONE", stage: "show" }]);
    expect(stages.map((s) => s.stage)).toEqual(["show"]);
  });
});

describe("summariseWorkCard", () => {
  test("sums done/total across every stage", () => {
    const stages = buildWorkCardStages(
      [],
      [
        { id: "t1", title: "A", status: "DONE", stage: "quote" },
        { id: "t2", title: "B", status: "TODO", stage: "prep" },
      ],
    );
    expect(summariseWorkCard(stages)).toEqual({ done: 1, total: 2 });
  });

  test("empty input summarises to zero/zero", () => {
    expect(summariseWorkCard([])).toEqual({ done: 0, total: 0 });
  });
});
