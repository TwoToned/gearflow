import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UX Phase 15 slice 3 (spec §9h.3): the planner's mail actions are gated on
 * the SERVER. `sendCrewOffers` only offers a call still waiting on an offer
 * (PENDING, or OFFERED for a resend) — it never knocks an ACCEPTED/CONFIRMED
 * call back to OFFERED. `sendCancellationEmails` only mails a call that is
 * really CANCELLED and in the caller's org.
 */
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const mailed = vi.hoisted(() => [] as { idempotencyKey: string; to: string }[]);
const patched = vi.hoisted(() => [] as { id: string }[]);

vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Alice" })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: vi.fn(async () => ({ name: "RVLT" })) } } }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email-side-effect", () => ({
  deliverSideEffectEmail: vi.fn(async (m: { idempotencyKey: string; to: string }) => {
    mailed.push(m);
  }),
}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://flow.test" } }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ mutation: vi.fn(async (_fn: unknown, a: { id: string }) => patched.push(a)) })),
}));
vi.mock("@/lib/locations-read", () => ({ getLocationById: vi.fn(async () => null) }));
vi.mock("@/lib/crew-scheduling-read", () => ({
  getAssignmentById: vi.fn(async (id: string) => rows.get(id) ?? null),
  getAssignmentsByProject: vi.fn(async () => []),
}));
vi.mock("@/lib/crew-read", () => ({
  getCrewMemberById: vi.fn(async () => ({ firstName: "Bob", lastName: "Ryan", email: "bob@x.com" })),
  getCrewRoleMap: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/projects-read", () => ({
  getProjectByIdMapped: vi.fn(async () => ({ name: "Launch", projectNumber: "2341", siteContactName: null, siteContactPhone: null, locationId: null })),
}));

import { sendCancellationEmails, sendCrewOffers } from "../crew-communication";

function call(id: string, status: string, over: Record<string, unknown> = {}) {
  rows.set(id, {
    id, organizationId: "org1", projectId: "p1", crewMemberId: "c1", crewRoleId: null, status, phase: "EVENT",
    startDate: new Date(Date.UTC(2026, 10, 17)), endDate: null, startTime: "08:00", endTime: "18:00", notes: null,
    updatedAt: new Date(1_700_000_000_000), ...over,
  });
}

beforeEach(() => {
  rows.clear();
  mailed.length = 0;
  patched.length = 0;
});

describe("sendCrewOffers — the offer gate", () => {
  it("offers PENDING and resends OFFERED; refuses an ACCEPTED or CONFIRMED call by name", async () => {
    call("pen", "PENDING");
    call("off", "OFFERED");
    call("acc", "ACCEPTED");
    call("con", "CONFIRMED");
    const res = await sendCrewOffers({ assignmentIds: ["pen", "off", "acc", "con"] });
    expect(res.sent).toBe(2);
    expect(res.errors).toEqual(["Bob Ryan is already accepted", "Bob Ryan is already confirmed"]);
    expect(patched.map((p) => p.id)).toEqual(["pen", "off"]);
    expect(mailed).toHaveLength(2);
  });
});

describe("sendCancellationEmails — the planner's Cancel n", () => {
  it("mails each CANCELLED call once, keyed by the cancel write's stamp", async () => {
    call("a1", "CANCELLED");
    const res = await sendCancellationEmails({ assignmentIds: ["a1", "a1"] });
    expect(res).toMatchObject({ sent: 1, total: 1, errors: [] });
    expect(mailed).toEqual([expect.objectContaining({ to: "bob@x.com", idempotencyKey: "crew-cancel:a1:1700000000000" })]);
  });

  it("never mails a call that still stands, or another org's", async () => {
    call("live", "CONFIRMED");
    call("theirs", "CANCELLED", { organizationId: "org2" });
    const res = await sendCancellationEmails({ assignmentIds: ["live", "theirs"] });
    expect(res.sent).toBe(0);
    expect(res.errors).toEqual(["Bob Ryan's call is not cancelled", "Assignment not found"]);
    expect(mailed).toHaveLength(0);
  });

  it("validates its input (an empty list is refused)", async () => {
    await expect(sendCancellationEmails({ assignmentIds: [] })).rejects.toThrow();
  });
});
