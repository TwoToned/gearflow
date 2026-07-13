import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { assertWritesEnabled } from "./writeGuard";

// Minimal MutationCtx stub — assertWritesEnabled only touches ctx.db.query(...).first().
type Flag = {
  writesDisabled?: boolean;
  disabledReason?: string;
  disabledDomains?: string[];
} | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxWith = (flag: Flag): any => ({
  db: { query: () => ({ first: async () => flag }) },
});

describe("assertWritesEnabled", () => {
  it("allows when there is no flags row (default enabled)", async () => {
    await expect(assertWritesEnabled(ctxWith(null))).resolves.toBeUndefined();
  });

  it("allows when writesDisabled is false", async () => {
    await expect(assertWritesEnabled(ctxWith({ writesDisabled: false }))).resolves.toBeUndefined();
  });

  it("throws (with reason) when the global switch is on", async () => {
    const p = assertWritesEnabled(ctxWith({ writesDisabled: true, disabledReason: "incident" }));
    await expect(p).rejects.toBeInstanceOf(ConvexError);
    await expect(p).rejects.toThrow(/temporarily disabled: incident/);
  });

  it("throws only for a disabled DOMAIN, allows others", async () => {
    const flag = { writesDisabled: false, disabledDomains: ["asset"] };
    await expect(assertWritesEnabled(ctxWith(flag), "asset")).rejects.toThrow(/"asset" are temporarily disabled/);
    await expect(assertWritesEnabled(ctxWith(flag), "dashboard")).resolves.toBeUndefined();
    // no domain passed → global check only → allowed
    await expect(assertWritesEnabled(ctxWith(flag))).resolves.toBeUndefined();
  });

  it("global switch beats domain scoping (kills everything)", async () => {
    const flag = { writesDisabled: true, disabledDomains: ["asset"] };
    await expect(assertWritesEnabled(ctxWith(flag), "dashboard")).rejects.toThrow(/temporarily disabled/);
  });
});
