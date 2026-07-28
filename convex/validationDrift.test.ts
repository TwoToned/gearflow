/**
 * Validation drift guard (POLICY.md R-8.6.1 — single source of truth).
 *
 * The client Zod schemas (src/lib/validations/*) and the Convex browser-direct
 * arg validators (the `*Fields` objects in convex/*Writes.ts) describe the SAME
 * business fields at two trust boundaries. They intentionally differ in
 * OPTIONALITY (client input has defaults/coercion; server args are structural),
 * so we don't mechanically derive one from the other — that would silently make
 * optional args required and reject valid writes.
 *
 * What we DO enforce here: the two must carry the SAME FIELD SET. Adding or
 * removing a field on one side without the other is drift — this test fails until
 * they're reconciled, which is the guarantee R-8.6.1 asks for. Per-pair `allow`
 * lists document any deliberate, reviewed divergence.
 *
 * The pairing table itself lives in src/lib/validations/registry.ts (promoted
 * there in Phase 2 / #998, R-3.1) so the API dispatcher can run the exact same
 * Zod↔Convex parity check the UI hooks get — this file only asserts it holds.
 */
import { describe, expect, it } from "vitest";
import { VALIDATION_PAIRS, zodKeys } from "@/lib/validations/registry";

describe("validation field-set parity (Zod client ↔ Convex server) — R-8.6.1", () => {
  it.each(VALIDATION_PAIRS)("$name: Convex validator and Zod schema share one field set", (pair) => {
    const zod = new Set(zodKeys(pair.zod));
    const convex = new Set(Object.keys(pair.convex));
    (pair.allowZodOnly ?? []).forEach((k) => zod.delete(k));
    (pair.allowConvexOnly ?? []).forEach((k) => convex.delete(k));

    const zodOnly = [...zod].filter((k) => !convex.has(k)).sort();
    const convexOnly = [...convex].filter((k) => !zod.has(k)).sort();

    expect(
      { zodOnly, convexOnly },
      `Drift in "${pair.name}": these fields exist on only one side. Reconcile the ` +
        `Zod schema (src/lib/validations) and the Convex *Fields validator, or add a ` +
        `documented allow entry in src/lib/validations/registry.ts.`,
    ).toEqual({ zodOnly: [], convexOnly: [] });
  });
});
