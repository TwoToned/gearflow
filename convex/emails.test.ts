// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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
    // Simulate a prior successful send by seeding the ledger row.
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

describe("emails.claim / release — idempotency ledger", () => {
  test("first claim wins; a concurrent claim of the same key is rejected", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.emails.claim, {
      idempotencyKey: "k1",
      to: args.to,
      subject: args.subject,
      now: NOW,
    });
    expect(first).toEqual({ claimed: true });

    const second = await t.mutation(internal.emails.claim, {
      idempotencyKey: "k1",
      to: args.to,
      subject: args.subject,
      now: NOW + 1,
    });
    expect(second).toEqual({ claimed: false });

    // Exactly one ledger row exists for the key.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("sentEmails")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", "k1"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sentAt).toBe(NOW);
  });

  test("release deletes the claim so a later attempt can re-claim (re-send)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.emails.claim, {
      idempotencyKey: "k2",
      to: args.to,
      subject: args.subject,
      now: NOW,
    });
    await t.mutation(internal.emails.release, { idempotencyKey: "k2" });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("sentEmails")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", "k2"))
        .collect(),
    );
    expect(rows).toHaveLength(0);

    // Re-claim now succeeds.
    const reclaim = await t.mutation(internal.emails.claim, {
      idempotencyKey: "k2",
      to: args.to,
      subject: args.subject,
      now: NOW + 5,
    });
    expect(reclaim).toEqual({ claimed: true });
  });

  test("release is a no-op on an unknown key", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.emails.release, { idempotencyKey: "nope" }),
    ).resolves.toBeNull();
  });
});

describe("emailActions.deliver — dedupe + mock delivery", () => {
  const savedKey = process.env.RESEND_API_KEY;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY; // force the mock path (no external send)
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  test("claims then mock-delivers when no RESEND_API_KEY is set, keeping the claim", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(internal.emailActions.deliver, {
      idempotencyKey: "k3",
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    expect(res).toEqual({ mock: true });

    // The claim is retained (mock "succeeds"), so a re-delivery skips.
    const again = await t.action(internal.emailActions.deliver, {
      idempotencyKey: "k3",
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    expect(again).toEqual({ skipped: true });
  });

  test("skips delivery for an already-claimed key", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.emails.claim, {
      idempotencyKey: "k4",
      to: args.to,
      subject: args.subject,
      now: NOW,
    });
    const res = await t.action(internal.emailActions.deliver, {
      idempotencyKey: "k4",
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    expect(res).toEqual({ skipped: true });
  });
});
