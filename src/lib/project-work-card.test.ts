import { describe, it, expect } from "vitest";
import { buildWorkDecisionRows } from "./project-work-card";
import type { ReadinessCheck } from "./project-readiness-checks";
import type { WorkTaskLike } from "./project-work";

const TZ = "Australia/Melbourne";
const NOW = Date.UTC(2026, 8, 19, 2, 0); // noon on the 19th in Melbourne

const check = (over: Partial<ReadinessCheck> & { id: ReadinessCheck["id"] }): ReadinessCheck => ({
  severity: "blocking",
  title: over.id,
  ...over,
});

const task = (over: Partial<WorkTaskLike> & { id: string }): WorkTaskLike => ({
  title: over.id,
  status: "TODO",
  ...over,
});

describe("buildWorkDecisionRows", () => {
  it("shows a failing check but never a passing one — the meter carries the reassurance", () => {
    const rows = buildWorkDecisionRows(
      [check({ id: "gear", title: "2 items short" }), check({ id: "crew", severity: "pass", title: "Crew booked" })],
      [],
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.id)).toEqual(["check:gear"]);
    expect(rows[0]).toMatchObject({ system: true, checkId: "gear", severity: "blocking" });
  });

  it("keeps the check's own action label and severity for the card's deep links", () => {
    const rows = buildWorkDecisionRows(
      [check({ id: "gear", severity: "unknown", title: "Not checked", actionLabel: "Set dates" })],
      [],
      NOW,
      TZ,
    );
    expect(rows[0]).toMatchObject({ actionLabel: "Set dates", severity: "unknown" });
  });

  it("lists late work and nothing that is merely open", () => {
    const rows = buildWorkDecisionRows(
      [],
      [
        task({ id: "late", title: "Confirm access", dueDate: "2026-09-18" }),
        task({ id: "ontrack", title: "Pack truck", dueDate: "2026-09-25", assigneeUserId: "u1" }),
        task({ id: "undated", title: "Someday", assigneeUserId: "u1" }),
      ],
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.id)).toEqual(["late", "unowned"]);
    expect(rows[0].lateLabel).toBe("1d late");
  });

  // D2: the old stage-grouped card skipped rows with no stage entirely, so a
  // late pre-#1243 task never reached the project's home page.
  it("does not skip a late row just because it has no stage", () => {
    const rows = buildWorkDecisionRows(
      [],
      [task({ id: "nostage", title: "Chase permits", dueDate: "2026-09-10", assigneeUserId: "u1" })],
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.id)).toEqual(["nostage"]);
  });

  it("never calls finished or cancelled work late, however old", () => {
    const rows = buildWorkDecisionRows(
      [],
      [
        task({ id: "done", dueDate: "2020-01-01", status: "DONE", assigneeUserId: "u1" }),
        task({ id: "cancelled", dueDate: "2020-01-01", status: "CANCELLED", assigneeUserId: "u1" }),
      ],
      NOW,
      TZ,
    );
    expect(rows).toEqual([]);
  });

  it("summarises unowned work as ONE row — the decision is 'assign these', not 'read these'", () => {
    const rows = buildWorkDecisionRows(
      [],
      [task({ id: "a" }), task({ id: "b" }), task({ id: "c", assigneeCrewId: "c1" })],
      NOW,
      TZ,
    );
    const unowned = rows.find((r) => r.id === "unowned")!;
    expect(unowned.title).toBe("2 items have no owner");
    expect(unowned.actionLabel).toBe("Assign");
  });

  it("uses the singular when exactly one item is unowned", () => {
    const rows = buildWorkDecisionRows([], [task({ id: "a" })], NOW, TZ);
    expect(rows.find((r) => r.id === "unowned")!.title).toBe("1 item has no owner");
  });

  it("orders checks before late work before the unowned summary", () => {
    const rows = buildWorkDecisionRows(
      [check({ id: "gear" })],
      [task({ id: "late", dueDate: "2026-09-01" })],
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.id)).toEqual(["check:gear", "late", "unowned"]);
  });

  it("is empty on a clean job, so the card can collapse to its meter", () => {
    expect(
      buildWorkDecisionRows(
        [check({ id: "gear", severity: "pass" })],
        [task({ id: "a", dueDate: "2026-09-25", assigneeUserId: "u1" })],
        NOW,
        TZ,
      ),
    ).toEqual([]);
  });
});
