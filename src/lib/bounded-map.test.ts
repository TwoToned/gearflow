import { describe, expect, it } from "vitest";
import { boundedMap } from "./bounded-map";

describe("boundedMap", () => {
  it("preserves order and maps every item", async () => {
    const out = await boundedMap([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await boundedMap(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list and rejects a bad limit", async () => {
    expect(await boundedMap([], 4, async (x) => x)).toEqual([]);
    await expect(boundedMap([1], 0, async (x) => x)).rejects.toThrow();
  });
});
