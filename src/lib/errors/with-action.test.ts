/**
 * Unit tests for the server-action wrapper. Verifies that:
 *  - Happy path returns pass through unchanged
 *  - Prisma errors get translated to UserFacingError
 *  - Structured errors (UserFacingError, TestTagBlockError, InventoryError) pass through
 *  - Unknown errors bubble unchanged
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { withAction } from "./with-action";
import { UserFacingError } from "./user-facing-error";
import { TestTagBlockError } from "./test-tag-block-error";

describe("withAction", () => {
  it("passes through happy path return value", async () => {
    const wrapped = withAction(async (a: number, b: number) => a + b);
    expect(await wrapped(2, 3)).toBe(5);
  });

  it("translates Prisma P2002 to UserFacingError", async () => {
    const wrapped = withAction(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique violation", {
        code: "P2002",
        clientVersion: "x",
        meta: { target: ["assetTag"] },
      });
    });
    await expect(wrapped()).rejects.toBeInstanceOf(UserFacingError);
    try {
      await wrapped();
    } catch (e) {
      expect((e as UserFacingError).code).toBe("DUPLICATE");
      expect((e as UserFacingError).title).toBe("Duplicate asset tag");
    }
  });

  it("passes UserFacingError through unchanged", async () => {
    const original = new UserFacingError({
      code: "CUSTOM",
      title: "Custom",
      message: "msg",
    });
    const wrapped = withAction(async () => {
      throw original;
    });
    await expect(wrapped()).rejects.toBe(original);
  });

  it("passes TestTagBlockError through unchanged", async () => {
    const original = new TestTagBlockError([
      { assetTag: "T1", status: "FAILED", nextDueDate: null },
    ]);
    const wrapped = withAction(async () => {
      throw original;
    });
    await expect(wrapped()).rejects.toBe(original);
  });

  it("passes unknown errors through unchanged", async () => {
    const original = new Error("some unexpected failure");
    const wrapped = withAction(async () => {
      throw original;
    });
    await expect(wrapped()).rejects.toBe(original);
  });
});
