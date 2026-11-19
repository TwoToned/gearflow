import { describe, it, expect } from "vitest";

import { factText, splitPhoneFacts } from "./facts";

describe("facts", () => {
  it("prints money as whole dollars with grouping, blank as a dash", () => {
    expect(factText({ kind: "money", amount: 23880 })).toBe("$23,880");
    expect(factText({ kind: "money", amount: 0 })).toBe("$0");
    expect(factText({ kind: "money", amount: null })).toBe("—");
  });

  it("phone split skips blank facts and puts the first qty/money on the right", () => {
    const { right, folded } = splitPhoneFacts(["qty", "avail", "price"], {
      qty: { kind: "qty", value: 4 },
      avail: { kind: "availability", state: "ok", free: 2 },
      price: { kind: "money", amount: null },
    });
    expect(right).toEqual({ kind: "qty", value: 4 });
    expect(folded).toHaveLength(1);
  });
});
