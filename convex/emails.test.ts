// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// The delivery action constructs `new Resend(apiKey)` only when RESEND_API_KEY is
// set; this mock makes that send fail so the retry path is exercised. Tests that
// want the mock (no-key) path simply leave RESEND_API_KEY unset.
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn(async () => ({ data: null, error: { message: "boom" } })) },
  })),
}));

const modules = import.meta.glob("./**/*.ts");

const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: "user_1", orgId });
const NOW = 1_700_000_000_000;

const args = {
  idempotencyKey: "crew-offer:a1:tok1",
  to: "crew@example.com",
  subject: "You have a crew offer",
  html: "<p>hi</p>",
};

function ledgerRows(t: ReturnType<typeof convexTest>, key: string) {
  // Full-scan + JS filter (test data is tiny). Avoids `.withIndex` here, which
  // trips a TS instantiation-depth quirk in convex-test's `t.run` ctx typing for
  // a freshly-added table on this large schema (the same index works fine in the
  // production query in emails.ts).
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("sentEmails").collect();
    return rows.filter((r) => r.idempotencyKey === key);
  });
}

describe("emails.enqueue — auth + scheduling", () => {
  test("requires the service token (a user token is rejected)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser("org_1")).mutation(api.emails.enqueue, args),
    ).rejects.toThrow();
  });

  test("schedules delivery on first enqueue for a key", async () => {
    const t = convexTest(schema, modules);
    const res = await t.withIdentity(SERVICE).mutation(api.emails.enqueue, args);
    expect(res).toEqual({ scheduled: true, alreadySent: false });
  });

  test("does not re-schedule when the key has already been delivered", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("sentEmails", {
        idempotencyKey: args.idempotencyKey,
        to: args.to,
        subject: args.subject,
        sentAt: NOW,
      });
    });
    const res = await t.withIdentity(SERVICE).mutation(api.emails.enqueue, args);
    expect(res).toEqual({ scheduled: false, alreadySent: true });
  });

  test("rejects an empty recipient", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(SERVICE).mutation(api.emails.enqueue, { ...args, to: "" }),
    ).rejects.toThrow(/recipient/);
  });
});

describe("emails.isSent / markSent — delivered ledger", () => {
  test("isSent flips false → true and markSent is idempotent", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.emails.isSent, { idempotencyKey: "k1" })).toBe(false);

    await t.mutation(internal.emails.markSent, {
      idempotencyKey: "k1",
      to: args.to,
      subject: args.subject,
      now: NOW,
    });
    expect(await t.query(internal.emails.isSent, { idempotencyKey: "k1" })).toBe(true);

    // A duplicate markSent leaves exactly one row (does not overwrite sentAt).
    await t.mutation(internal.emails.markSent, {
      idempotencyKey: "k1",
      to: args.to,
      subject: args.subject,
      now: NOW + 999,
    });
    const rows = await ledgerRows(t, "k1");
    expect(rows).toHaveLength(1);
    expect(rows[0].sentAt).toBe(NOW);
  });
});

describe("emailActions.deliver — mock delivery + dedupe", () => {
  const savedKey = process.env.RESEND_API_KEY;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY; // force the mock path (no external send)
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  });

  test("mock-delivers when no RESEND_API_KEY, records the ledger, and later re-delivery skips", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(internal.emailActions.deliver, { ...args, idempotencyKey: "k2", attempt: 1 });
    expect(res).toEqual({ mock: true });
    expect(await ledgerRows(t, "k2")).toHaveLength(1);

    const again = await t.action(internal.emailActions.deliver, { ...args, idempotencyKey: "k2", attempt: 1 });
    expect(again).toEqual({ skipped: true });
  });

  test("skips delivery for an already-delivered key", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.emails.markSent, {
      idempotencyKey: "k3",
      to: args.to,
      subject: args.subject,
      now: NOW,
    });
    const res = await t.action(internal.emailActions.deliver, { ...args, idempotencyKey: "k3", attempt: 1 });
    expect(res).toEqual({ skipped: true });
  });
});

describe("emailActions.deliver — bounded retry on failure", () => {
  const savedKey = process.env.RESEND_API_KEY;
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_realish_key"; // trigger the (mocked, failing) Resend send
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  });

  test("reschedules with an incremented attempt and writes no ledger row", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(internal.emailActions.deliver, { ...args, idempotencyKey: "k4", attempt: 1 });
    expect(res).toEqual({ retrying: true, attempt: 2 });
    expect(await ledgerRows(t, "k4")).toHaveLength(0); // NOT marked sent — will retry
  });

  test("gives up (failed, no ledger row) after the final attempt", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(internal.emailActions.deliver, { ...args, idempotencyKey: "k5", attempt: 3 });
    expect(res).toEqual({ failed: true, attempt: 3 });
    expect(await ledgerRows(t, "k5")).toHaveLength(0);
  });
});
