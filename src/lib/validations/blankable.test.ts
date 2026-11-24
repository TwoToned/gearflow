import { describe, it, expect } from "vitest";
import { z } from "zod";

import { blankableNumber } from "./blankable";

const price = z.object({ price: blankableNumber(z.number().min(0).max(1000)) });

describe("blankableNumber", () => {
  it("keeps a blank blank, never $0", () => {
    expect(price.parse({ price: "" }).price).toBeUndefined();
    expect(price.parse({ price: null }).price).toBeUndefined();
    expect(price.parse({}).price).toBeUndefined();
  });

  it("keeps a typed 0 as a real 0 and coerces numeric strings", () => {
    expect(price.parse({ price: 0 }).price).toBe(0);
    expect(price.parse({ price: "0" }).price).toBe(0);
    expect(price.parse({ price: "12.5" }).price).toBe(12.5);
  });

  it("applies the wrapped bounds", () => {
    expect(price.safeParse({ price: -1 }).success).toBe(false);
    expect(price.safeParse({ price: 1001 }).success).toBe(false);
    expect(price.safeParse({ price: "abc" }).success).toBe(false);
  });
});
