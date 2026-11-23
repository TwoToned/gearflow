import { describe, expect, it, vi } from "vitest";

// The send actions are server actions; the batching itself is what's under test.
vi.mock("@/server/crew-communication", () => ({ sendCrewOffers: vi.fn(), sendCancellationEmails: vi.fn() }));
vi.mock("@/hooks/use-crew-assignment-writes", () => ({ useCrewAssignmentWrites: () => ({}) }));

import { MAX_CREW_MAIL_BATCH, crewMailBatchSchema } from "@/lib/validations/crew";
import { mailInBatches } from "../planner/use-planner-writes";

describe("crew mail goes out in batches the action accepts", () => {
  it("a 150-call Cancel emails everyone: two calls (100 + 50), one merged result", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `a${i}`);
    // A faithful fake: it validates exactly as the server action does.
    const send = vi.fn(async (input: { assignmentIds: string[] }) => {
      const { assignmentIds } = crewMailBatchSchema.parse(input);
      return { sent: assignmentIds.length - 1, errors: [`${assignmentIds[0]} has no email`], total: assignmentIds.length };
    });
    const r = await mailInBatches(send, ids);
    expect(send.mock.calls.map(([i]) => i.assignmentIds.length)).toEqual([MAX_CREW_MAIL_BATCH, 50]);
    expect(send.mock.calls.flatMap(([i]) => i.assignmentIds)).toEqual(ids);
    expect(r).toEqual({ sent: 148, total: 150, errors: ["a0 has no email", "a100 has no email"] });
  });

  it("one unbatched call of 150 is exactly what the action refuses", () => {
    expect(() => crewMailBatchSchema.parse({ assignmentIds: Array.from({ length: 150 }, (_, i) => `a${i}`) })).toThrow();
  });

  it("nothing to send, no call", async () => {
    const send = vi.fn();
    expect(await mailInBatches(send, [])).toEqual({ sent: 0, errors: [], total: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
